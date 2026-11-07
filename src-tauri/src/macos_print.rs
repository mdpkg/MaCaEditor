use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool, NSObject};
use objc2::{define_class, msg_send, sel, AllocAnyThread, DefinedClass, MainThreadMarker};
use objc2_app_kit::{
    NSPaperOrientation, NSPrintHeaderAndFooter, NSPrintInfo, NSPrintJobSavingURL, NSPrintOperation,
    NSPrintSaveJob, NSWindow,
};
use objc2_foundation::{NSDictionary, NSNumber, NSSize, NSString, NSURL};
use objc2_pdf_kit::{PDFDocument, PDFPrintScalingMode};
use objc2_web_kit::WKWebView;
use std::ffi::c_void;
use std::fs::{self, DirBuilder};
use std::os::unix::fs::DirBuilderExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{webview::PlatformWebview, WebviewWindow};
use tokio::sync::oneshot;

type PrintResult = Result<bool, String>;

struct Completion {
    sender: Mutex<Option<oneshot::Sender<PrintResult>>>,
    _document: Option<Retained<PDFDocument>>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "MaCaPrintCompletion"]
    #[ivars = Completion]
    struct PrintCompletion;

    impl PrintCompletion {
        #[unsafe(method(printOperationDidRun:success:contextInfo:))]
        fn completed(&self, _operation: &NSPrintOperation, success: Bool, context: *mut c_void) {
            // Release the reference passed to AppKit after its completion callback.
            let delegate = unsafe { Retained::from_raw(context.cast::<Self>()) };
            if let Some(delegate) = delegate {
                if let Ok(mut sender) = delegate.ivars().sender.lock() {
                    if let Some(sender) = sender.take() {
                        let _ = sender.send(Ok(success.as_bool()));
                    }
                }
            }
        }
    }
);

struct PrintFile {
    directory: PathBuf,
    pdf: PathBuf,
}

impl PrintFile {
    fn new() -> std::io::Result<Self> {
        let directory = std::env::temp_dir().join(format!("maca-print-{}", uuid::Uuid::new_v4()));
        DirBuilder::new().mode(0o700).create(&directory)?;
        let pdf = directory.join("pages.pdf");
        Ok(Self { directory, pdf })
    }
}

impl Drop for PrintFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.pdf);
        let _ = fs::remove_dir(&self.directory);
    }
}

fn file_url(path: &Path) -> Result<Retained<NSURL>, String> {
    let path = path.to_str().ok_or("Invalid temporary print path")?;
    Ok(NSURL::fileURLWithPath(&NSString::from_str(path)))
}

fn capture_info(path: &Path) -> Result<Retained<NSPrintInfo>, String> {
    let url = file_url(path)?;
    let no = NSNumber::numberWithBool(false);
    let values: [&AnyObject; 2] = [&url, &no];
    let attributes = unsafe {
        NSDictionary::from_slices(&[NSPrintJobSavingURL, NSPrintHeaderAndFooter], &values)
    };
    let info = unsafe { NSPrintInfo::initWithDictionary(NSPrintInfo::alloc(), &attributes) };
    let points_per_mm = 72.0 / 25.4;
    info.setPaperSize(NSSize::new(210.0 * points_per_mm, 297.0 * points_per_mm));
    info.setOrientation(NSPaperOrientation::Portrait);
    info.setTopMargin(0.0);
    info.setBottomMargin(0.0);
    info.setLeftMargin(0.0);
    info.setRightMargin(0.0);
    info.setJobDisposition(unsafe { NSPrintSaveJob });
    Ok(info)
}

async fn run_modal(
    window: &WebviewWindow,
    create: impl FnOnce(
            &PlatformWebview,
            MainThreadMarker,
        )
            -> Result<(Retained<NSPrintOperation>, Option<Retained<PDFDocument>>), String>
        + Send
        + 'static,
) -> PrintResult {
    let (sender, finished) = oneshot::channel();
    window
        .with_webview(move |platform| {
            let ready = (|| {
                let main_thread = MainThreadMarker::new().ok_or("Missing AppKit main thread")?;
                // Tauri provides the live AppKit window on its main thread.
                let window = unsafe { platform.ns_window().cast::<NSWindow>().as_ref() }
                    .ok_or("Missing AppKit print window")?;
                let (operation, document) = create(&platform, main_thread)?;
                Ok::<_, String>((window, operation, document))
            })();
            let (window, operation, document) = match ready {
                Ok(ready) => ready,
                Err(error) => {
                    let _ = sender.send(Err(error));
                    return;
                }
            };
            let delegate = PrintCompletion::alloc().set_ivars(Completion {
                sender: Mutex::new(Some(sender)),
                _document: document,
            });
            let delegate: Retained<PrintCompletion> = unsafe { msg_send![super(delegate), init] };
            let context = Retained::into_raw(delegate);
            operation.setCanSpawnSeparateThread(true);
            // AppKit retains the operation and invokes the delegate on completion or cancellation.
            unsafe {
                operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                    window,
                    Some(&*context),
                    Some(sel!(printOperationDidRun:success:contextInfo:)),
                    context.cast(),
                );
            }
        })
        .map_err(|error| error.to_string())?;
    finished.await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn print_prepared_pages(window: WebviewWindow, title: String) -> Result<(), String> {
    let file = PrintFile::new().map_err(|error| error.to_string())?;
    let capture = file.pdf.clone();
    let captured = run_modal(&window, move |platform, _| {
        let info = capture_info(&capture)?;
        // Tauri provides the live WKWebView on its main thread.
        let view = unsafe { platform.inner().cast::<WKWebView>().as_ref() }
            .ok_or("Missing WKWebView for printing")?;
        let operation = unsafe { view.printOperationWithPrintInfo(&info) };
        operation.setShowsPrintPanel(false);
        operation.setShowsProgressPanel(false);
        Ok((operation, None))
    })
    .await?;
    if !captured {
        return Err("WKWebView could not capture the prepared print pages".into());
    }

    // WebKit uses the window dimensions for print media queries on macOS.
    // PDFKit can fit the fixed pages to the actual paper selected in AppKit.
    let source = file.pdf.clone();
    run_modal(&window, move |_, main_thread| {
        let url = file_url(&source)?;
        let document = unsafe { PDFDocument::initWithURL(PDFDocument::alloc(), &url) }
            .ok_or("PDFKit could not open the prepared pages")?;
        let info = NSPrintInfo::sharedPrintInfo();
        let operation = unsafe {
            document.printOperationForPrintInfo_scalingMode_autoRotate(
                Some(&info),
                PDFPrintScalingMode::PageScaleDownToFit,
                false,
                main_thread,
            )
        }
        .ok_or("PDFKit could not create the print operation")?;
        operation.setJobTitle(Some(&NSString::from_str(&title)));
        Ok((operation, Some(document)))
    })
    .await?;
    Ok(())
}
