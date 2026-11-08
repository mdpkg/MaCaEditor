use std::{
    collections::HashMap,
    io,
    mem::size_of,
    ptr::{null, null_mut},
    slice,
    sync::{mpsc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::ipc::Channel;
use tokio::sync::oneshot;
use windows_sys::{
    core::w,
    Win32::{
        Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0, WAIT_TIMEOUT},
        Graphics::Printing::*,
        System::{
            EventLog::*,
            Threading::{CreateEventW, WaitForSingleObject},
        },
    },
};

use super::PrintMonitorEvent;

const PREVIEW_TIMEOUT: Duration = Duration::from_secs(600);
const EVENT_GRACE: Duration = Duration::from_secs(3);

#[derive(Default)]
pub struct PrintMonitor {
    sender: Mutex<Option<mpsc::Sender<Request>>>,
}

struct Request {
    title: String,
    channel: Channel<PrintMonitorEvent>,
    ready: oneshot::Sender<Result<(), String>>,
}

impl PrintMonitor {
    pub async fn register(&self, channel: Channel<PrintMonitorEvent>) -> Result<String, String> {
        // WebView2 shortens long spooler names in the middle. Keep the marker
        // and its separator within the retained prefix.
        let id = uuid::Uuid::new_v4().simple().to_string();
        let title = format!("MaCa-{}", &id[..24]);
        let (ready, started) = oneshot::channel();
        {
            let mut sender = self.sender.lock().map_err(|error| error.to_string())?;
            if sender.is_none() {
                let (tx, rx) = mpsc::channel();
                thread::Builder::new()
                    .name("print-monitor".into())
                    .spawn(move || monitor_prints(rx))
                    .map_err(|error| error.to_string())?;
                *sender = Some(tx);
            }
            sender
                .as_ref()
                .unwrap()
                .send(Request {
                    title: title.clone(),
                    channel,
                    ready,
                })
                .map_err(|error| error.to_string())?;
        }
        started.await.map_err(|error| error.to_string())??;
        Ok(title)
    }
}

struct PendingPrint {
    channel: Channel<PrintMonitorEvent>,
    started: Instant,
}

type Pending = HashMap<String, PendingPrint>;

fn add_request(pending: &mut Pending, request: Request) {
    if request.ready.send(Ok(())).is_ok() {
        pending.insert(
            request.title,
            PendingPrint {
                channel: request.channel,
                started: Instant::now(),
            },
        );
    }
}

fn monitor_prints(requests: mpsc::Receiver<Request>) {
    while let Ok(first) = requests.recv() {
        if let Err(error) = monitor_session(&requests, first) {
            eprintln!("Windows print monitor: {error}");
        }
    }
}

fn monitor_session(requests: &mpsc::Receiver<Request>, first: Request) -> io::Result<()> {
    let (queue, events) = match Queue::open().and_then(|queue| Ok((queue, FailureEvents::open()?)))
    {
        Ok(sources) => sources,
        Err(error) => {
            let _ = first.ready.send(Err(error.to_string()));
            return Err(error);
        }
    };
    let mut pending = Pending::new();
    let mut jobs = HashMap::new();
    let mut failures = Vec::<(Instant, Failure)>::new();
    if let Err(error) = queue.read(&mut jobs, true) {
        let _ = first.ready.send(Err(error.to_string()));
        return Err(error);
    }
    add_request(&mut pending, first);
    while !pending.is_empty() {
        for request in requests.try_iter() {
            add_request(&mut pending, request);
        }
        match queue.read_changes(&mut jobs) {
            Ok(true) => failures.clear(),
            Ok(false) => {}
            Err(error) => {
                notify_monitoring_failure(&pending, &error);
                return Err(error);
            }
        }
        let now = Instant::now();
        failures.extend(events.read().map(|failure| (now, failure)));
        failures.retain(|(received, failure)| {
            if let Some(key) = failure
                .pending_title(&pending, &jobs, now)
                .map(str::to_owned)
            {
                if let Some(print) = pending.remove(&key) {
                    let _ = print.channel.send(PrintMonitorEvent::JobFailed(failure.detail()));
                }
                return false;
            }
            now.duration_since(*received) < EVENT_GRACE
        });
        update_pending_jobs(&mut pending, &jobs, now);
        jobs.retain(|_, job| job.ended.is_none() || job.awaiting_failure_event(now));
    }
    Ok(())
}

fn notify_monitoring_failure(pending: &Pending, error: &io::Error) {
    // One lost session can affect several registered prints in the main window.
    // Report it once through the most recently registered print.
    if let Some(print) = pending.values().max_by_key(|print| print.started) {
        let _ = print.channel.send(PrintMonitorEvent::MonitoringFailed(error.to_string()));
    }
}

fn update_pending_jobs(pending: &mut Pending, jobs: &HashMap<u32, Job>, now: Instant) {
    pending.retain(|title, print| {
        let Some(job) = jobs.values().find(|job| title_matches(&job.document, title)) else {
            return now.duration_since(print.started) < PREVIEW_TIMEOUT;
        };
        // Give PrintService a chance to provide the original failure record first.
        if job.awaiting_failure_event(now) {
            return true;
        }
        if job.status & JOB_STATUS_ERROR != 0 && job.status & JOB_STATUS_PRINTED == 0 {
            let detail = if job.status_text.trim().is_empty() {
                format!("JOB_STATUS_ERROR (Status 0x{:08X})", job.status)
            } else {
                job.status_text.clone()
            };
            let _ = print.channel.send(PrintMonitorEvent::JobFailed(detail));
            return false;
        }
        job.ended.is_none()
    });
}

fn title_matches(document: &str, title: &str) -> bool {
    document == title
        || document
            .strip_prefix(title)
            .is_some_and(|rest| rest.starts_with(" — "))
}

struct Job {
    document: String,
    printer: String,
    owner: String,
    bytes: u32,
    status: u32,
    status_text: String,
    status_since: Instant,
    ended: Option<Instant>,
}

impl Job {
    fn new(now: Instant) -> Self {
        Self {
            document: String::new(),
            printer: String::new(),
            owner: String::new(),
            bytes: 0,
            status: 0,
            status_text: String::new(),
            status_since: now,
            ended: None,
        }
    }

    fn awaiting_failure_event(&self, now: Instant) -> bool {
        let since = self.ended.map_or(self.status_since, |ended| ended.max(self.status_since));
        now.duration_since(since) < EVENT_GRACE
    }
}

struct Failure {
    document: String,
    printer: String,
    owner: String,
    bytes: u32,
    code: String,
    message: String,
}

impl Failure {
    fn pending_title<'a>(
        &self,
        pending: &'a Pending,
        jobs: &HashMap<u32, Job>,
        now: Instant,
    ) -> Option<&'a str> {
        if let Some(title) = pending
            .keys()
            .find(|title| title_matches(&self.document, title))
        {
            return Some(title);
        }
        // Some drivers replace the document name in event 372. Match the queue entry
        // only when its owner, printer and spool size identify a single candidate.
        if self.bytes == 0 || self.printer.is_empty() || self.owner.is_empty() {
            return None;
        }
        let mut candidates = jobs.values().filter(|job| {
            job.printer.eq_ignore_ascii_case(&self.printer)
                && job.owner.eq_ignore_ascii_case(&self.owner)
                && job.bytes == self.bytes
                && job.status & (JOB_STATUS_PRINTED | JOB_STATUS_COMPLETE) == 0
                && job
                    .ended
                    .is_none_or(|ended| now.duration_since(ended) < EVENT_GRACE)
        });
        let job = candidates.next()?;
        if candidates.next().is_some()
            || job.status & (JOB_STATUS_DELETING | JOB_STATUS_DELETED | JOB_STATUS_ERROR) == 0
            || now.duration_since(job.status_since) >= EVENT_GRACE
        {
            return None;
        }
        pending
            .keys()
            .find(|title| title_matches(&job.document, title))
            .map(String::as_str)
    }

    fn detail(&self) -> String {
        if self.message.is_empty() {
            format!("Win32 エラー コード: {}", self.code)
        } else {
            format!("Win32 エラー コード: {}\n{}", self.code, self.message)
        }
    }
}

struct Queue {
    printer: PRINTER_HANDLE,
    change: HANDLE,
}

impl Queue {
    fn open() -> io::Result<Self> {
        let mut printer = PRINTER_HANDLE::default();
        // A null printer name opens the local print server, including its queues.
        if unsafe { OpenPrinterW(null(), &mut printer, null()) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut queue = Self {
            printer,
            change: INVALID_HANDLE_VALUE,
        };
        let mut fields = [
            JOB_NOTIFY_FIELD_DOCUMENT as u16,
            JOB_NOTIFY_FIELD_PRINTER_NAME as u16,
            JOB_NOTIFY_FIELD_USER_NAME as u16,
            JOB_NOTIFY_FIELD_TOTAL_BYTES as u16,
            JOB_NOTIFY_FIELD_STATUS as u16,
            JOB_NOTIFY_FIELD_STATUS_STRING as u16,
        ];
        let mut field_type = PRINTER_NOTIFY_OPTIONS_TYPE {
            Type: JOB_NOTIFY_TYPE as u16,
            Count: fields.len() as u32,
            pFields: fields.as_mut_ptr(),
            ..Default::default()
        };
        let options = PRINTER_NOTIFY_OPTIONS {
            Version: 2,
            Flags: 0,
            Count: 1,
            pTypes: &mut field_type,
        };
        queue.change = unsafe {
            FindFirstPrinterChangeNotification(
                queue.printer,
                PRINTER_CHANGE_JOB,
                0,
                (&raw const options).cast(),
            )
        };
        if queue.change == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        Ok(queue)
    }

    fn wait(&self) -> io::Result<bool> {
        match unsafe { WaitForSingleObject(self.change, 200) } {
            WAIT_OBJECT_0 => Ok(true),
            WAIT_TIMEOUT => Ok(false),
            _ => Err(io::Error::last_os_error()),
        }
    }

    fn read_changes(&self, jobs: &mut HashMap<u32, Job>) -> io::Result<bool> {
        if !self.wait()? || self.read(jobs, false)? {
            return Ok(false);
        }
        jobs.clear();
        self.read(jobs, true)?;
        Ok(true)
    }

    fn read(&self, jobs: &mut HashMap<u32, Job>, refresh: bool) -> io::Result<bool> {
        let mut change = 0;
        let mut result = null_mut();
        let options = PRINTER_NOTIFY_OPTIONS {
            Version: 2,
            Flags: PRINTER_NOTIFY_OPTIONS_REFRESH,
            ..Default::default()
        };
        let options = if refresh {
            (&raw const options).cast()
        } else {
            null()
        };
        if unsafe {
            FindNextPrinterChangeNotification(self.change, &mut change, options, &mut result)
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        if result.is_null() {
            return Ok(true);
        }
        let info = result.cast::<PRINTER_NOTIFY_INFO>();
        // The spooler allocates Count entries after the fixed notification header.
        let read = unsafe {
            if (*info).Flags & PRINTER_NOTIFY_INFO_DISCARDED != 0 && !refresh {
                false
            } else {
                let now = Instant::now();
                let data = (&raw const (*info).aData).cast::<PRINTER_NOTIFY_INFO_DATA>();
                let entries = slice::from_raw_parts(data, (*info).Count as usize);
                for entry in entries
                    .iter()
                    .filter(|entry| u32::from(entry.Type) == JOB_NOTIFY_TYPE)
                {
                    let job = jobs.entry(entry.Id).or_insert_with(|| Job::new(now));
                    match u32::from(entry.Field) {
                        JOB_NOTIFY_FIELD_DOCUMENT => job.document = queue_string(entry),
                        JOB_NOTIFY_FIELD_PRINTER_NAME => job.printer = queue_string(entry),
                        JOB_NOTIFY_FIELD_USER_NAME => job.owner = queue_string(entry),
                        JOB_NOTIFY_FIELD_STATUS_STRING => job.status_text = queue_string(entry),
                        JOB_NOTIFY_FIELD_TOTAL_BYTES => job.bytes = entry.NotifyData.adwData[0],
                        JOB_NOTIFY_FIELD_STATUS => {
                            let status = entry.NotifyData.adwData[0];
                            if job.status != status {
                                job.status_since = now;
                                job.status = status;
                            }
                            if status & (JOB_STATUS_DELETED | JOB_STATUS_PRINTED) != 0 {
                                job.ended.get_or_insert(now);
                            }
                        }
                        _ => {}
                    }
                }
                true
            }
        };
        unsafe { FreePrinterNotifyInfo(info) };
        Ok(read)
    }
}

impl Drop for Queue {
    fn drop(&mut self) {
        unsafe {
            if self.change != INVALID_HANDLE_VALUE {
                FindClosePrinterChangeNotification(self.change);
            }
            ClosePrinter(self.printer);
        }
    }
}

unsafe fn queue_string(entry: &PRINTER_NOTIFY_INFO_DATA) -> String {
    let data = entry.NotifyData.Data;
    if data.pBuf.is_null() {
        return String::new();
    }
    let buffer = slice::from_raw_parts(data.pBuf.cast::<u16>(), data.cbBuf as usize / 2);
    String::from_utf16_lossy(buffer.split(|unit| *unit == 0).next().unwrap_or_default())
}

struct FailureEvents {
    signal: HANDLE,
    subscription: EVT_HANDLE,
    context: EVT_HANDLE,
}

impl FailureEvents {
    fn open() -> io::Result<Self> {
        let signal = unsafe { CreateEventW(null(), 0, 0, null()) };
        if signal.is_null() {
            return Err(io::Error::last_os_error());
        }
        let mut events = Self {
            signal,
            subscription: 0,
            context: 0,
        };
        events.context = unsafe { EvtCreateRenderContext(0, null(), EvtRenderContextUser) };
        if events.context == 0 {
            return Err(io::Error::last_os_error());
        }
        events.subscription = unsafe {
            EvtSubscribe(
                0,
                signal,
                w!("Microsoft-Windows-PrintService/Admin"),
                w!("*[System[EventID=372]]"),
                0,
                null(),
                None,
                EvtSubscribeToFutureEvents,
            )
        };
        if events.subscription == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(events)
    }

    fn read(&self) -> impl Iterator<Item = Failure> + '_ {
        std::iter::from_fn(|| {
            let mut event = 0;
            let mut count = 0;
            (unsafe { EvtNext(self.subscription, 1, &mut event, 0, 0, &mut count) } != 0)
                .then_some(event)
        })
        .filter_map(|event| {
            let failure = self.render(event);
            unsafe { EvtClose(event) };
            failure
        })
    }

    fn render(&self, event: EVT_HANDLE) -> Option<Failure> {
        let mut bytes = 0;
        let mut count = 0;
        unsafe {
            EvtRender(
                self.context,
                event,
                EvtRenderEventValues,
                0,
                null_mut(),
                &mut bytes,
                &mut count,
            )
        };
        if bytes == 0 {
            return None;
        }
        // Keep the buffer aligned for EVT_VARIANT and for the strings it references.
        let mut buffer =
            vec![EVT_VARIANT::default(); (bytes as usize).div_ceil(size_of::<EVT_VARIANT>())];
        if unsafe {
            EvtRender(
                self.context,
                event,
                EvtRenderEventValues,
                bytes,
                buffer.as_mut_ptr().cast(),
                &mut bytes,
                &mut count,
            )
        } == 0
            || count < 11
        {
            return None;
        }
        let value = |index: usize| {
            let variant = &buffer[index];
            if variant.Type != EvtVarTypeString as u32 {
                return String::new();
            }
            unsafe {
                let string = variant.Anonymous.StringVal;
                if string.is_null() {
                    return String::new();
                }
                let len = (0..).take_while(|offset| *string.add(*offset) != 0).count();
                String::from_utf16_lossy(slice::from_raw_parts(string, len))
            }
        };
        // Event 372's template stores the document, owner, printer, spool size,
        // Win32 error code and original system message in these fields.
        Some(Failure {
            document: value(0),
            owner: value(1),
            printer: value(2),
            bytes: value(4).parse().unwrap_or_default(),
            code: value(9),
            message: value(10),
        })
    }
}

impl Drop for FailureEvents {
    fn drop(&mut self) {
        unsafe {
            if self.subscription != 0 {
                EvtClose(self.subscription);
            }
            if self.context != 0 {
                EvtClose(self.context);
            }
            CloseHandle(self.signal);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TITLE: &str = "MaCa-1234567890abcdef12345678";

    #[test]
    fn reports_queue_error_after_grace_even_without_status_text() {
        for (text, status, expected) in [
            ("", JOB_STATUS_ERROR, "JOB_STATUS_ERROR (Status 0x00000002)"),
            (" \r\n", JOB_STATUS_ERROR | JOB_STATUS_DELETED, "JOB_STATUS_ERROR (Status 0x00000102)"),
            ("Driver status message", JOB_STATUS_ERROR, "Driver status message"),
        ] {
            let now = Instant::now();
            let (tx, rx) = mpsc::channel();
            let mut pending = Pending::from([(
                TITLE.to_owned(),
                PendingPrint {
                    channel: Channel::new(move |body| {
                        tx.send(body.deserialize::<PrintMonitorEvent>()?).unwrap();
                        Ok(())
                    }),
                    started: now,
                },
            )]);
            let mut job = Job::new(now);
            job.document = format!("{TITLE} — example.mdpkg");
            job.status = status;
            job.status_text = text.to_owned();
            if status & JOB_STATUS_DELETED != 0 {
                job.ended = Some(now);
            }
            let jobs = HashMap::from([(1, job)]);

            update_pending_jobs(&mut pending, &jobs, now);
            assert!(rx.try_recv().is_err());
            assert!(pending.contains_key(TITLE));
            update_pending_jobs(&mut pending, &jobs, now + EVENT_GRACE);
            assert_eq!(rx.try_recv().unwrap(), PrintMonitorEvent::JobFailed(expected.to_owned()));
            assert!(pending.is_empty());
        }
    }

    #[test]
    fn ignores_cancelled_and_printed_jobs_and_errors_from_other_documents() {
        let now = Instant::now();
        for (document, status, ended, keep_pending) in [
            (TITLE, JOB_STATUS_DELETED, Some(now), false),
            (TITLE, JOB_STATUS_ERROR | JOB_STATUS_PRINTED, Some(now), false),
            ("Other document", JOB_STATUS_ERROR, None, true),
        ] {
            let mut pending = Pending::from([(
                TITLE.to_owned(),
                PendingPrint {
                    channel: Channel::new(|_| panic!("unexpected print error")),
                    started: now,
                },
            )]);
            let mut job = Job::new(now);
            job.document = document.to_owned();
            job.status = status;
            job.ended = ended;

            update_pending_jobs(&mut pending, &HashMap::from([(1, job)]), now + EVENT_GRACE);
            assert_eq!(pending.contains_key(TITLE), keep_pending);
        }
    }

    #[test]
    fn reports_one_monitoring_failure_with_the_os_error() {
        let now = Instant::now();
        let (tx, rx) = mpsc::channel();
        let pending = Pending::from([
            (
                "earlier".to_owned(),
                PendingPrint {
                    channel: Channel::new(|_| panic!("duplicate monitoring error")),
                    started: now,
                },
            ),
            (
                "later".to_owned(),
                PendingPrint {
                    channel: Channel::new(move |body| {
                        tx.send(body.deserialize::<PrintMonitorEvent>()?).unwrap();
                        Ok(())
                    }),
                    started: now + Duration::from_secs(1),
                },
            ),
        ]);
        let error = io::Error::from_raw_os_error(6);

        notify_monitoring_failure(&pending, &error);

        assert_eq!(rx.try_recv().unwrap(), PrintMonitorEvent::MonitoringFailed(error.to_string()));
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn associates_renamed_failure_only_with_a_unique_matching_job() {
        let now = Instant::now();
        let pending = Pending::from([(
            TITLE.to_owned(),
            PendingPrint {
                channel: Channel::new(|_| Ok(())),
                started: now,
            },
        )]);
        let failure = Failure {
            document: "ドキュメントの印刷".into(),
            printer: "Microsoft Print to PDF".into(),
            owner: "editor".into(),
            bytes: 13411,
            code: "5".into(),
            message: "アクセスが拒否されました。\n".into(),
        };
        let mut job = Job::new(now);
        job.document = format!("{TITLE} — example...th.mdpkg");
        job.printer = failure.printer.clone();
        job.owner = failure.owner.clone();
        job.bytes = failure.bytes;
        let mut jobs = HashMap::from([(1, job)]);
        assert_eq!(failure.pending_title(&pending, &jobs, now), None);
        jobs.get_mut(&1).unwrap().status = JOB_STATUS_DELETED;
        assert_eq!(failure.pending_title(&pending, &jobs, now), Some(TITLE));
        assert_eq!(
            failure.detail(),
            "Win32 エラー コード: 5\nアクセスが拒否されました。\n"
        );

        let mut other = Job::new(now);
        other.document = "Another application".into();
        other.printer = failure.printer.clone();
        other.owner = failure.owner.clone();
        other.bytes = failure.bytes;
        jobs.insert(2, other);
        assert_eq!(failure.pending_title(&pending, &jobs, now), None);
        jobs.remove(&1);
        assert_eq!(failure.pending_title(&pending, &jobs, now), None);
    }
}
