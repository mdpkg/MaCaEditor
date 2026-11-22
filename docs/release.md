# リリース手順

MaCa Editor の安定版 `vX.Y.Z` を GitHub Releases で公開する手順です。公開処理の実体は [Release ワークフロー](../.github/workflows/release.yml)、検証は [Checks ワークフロー](../.github/workflows/checks.yml) を参照してください。ワークフローを変更した際は、この手順も更新します。

以下のコマンド例はリポジトリのルートから PowerShell で実行します。Git、GitHub CLI、Node.js/npm、Rust、各 OS の Tauri ビルド環境が必要です。コマンドの成功を確認してから次へ進んでください。

## 1. 対象と既存状態を確認する

依頼されたバージョン、公開対象の変更、最新の `main`、既存の PR・タグ・Release を確認します。例の `2.6.0` は、実際に公開する未使用バージョンへ置き換えてください。

```powershell
$releaseVersion = '2.6.0'
$releaseTag = "v$releaseVersion"
$releaseRepo = 'mdpkg/MaCaEditor'
$releaseRoot = (git rev-parse --show-toplevel).Trim()
$releaseBranch = "codex/release-v$releaseVersion"
$releaseWorktree = Join-Path $releaseRoot ".worktrees/release-v$releaseVersion"

git status --short
git worktree list
git fetch origin --tags
git log -1 --oneline origin/main
git tag --list $releaseTag
git ls-remote --tags origin "refs/tags/$releaseTag"
gh release list --repo $releaseRepo --limit 5
gh pr list --repo $releaseRepo --state open
```

既存タグ・Release がある場合は、新規公開か既存ビルドの復旧かを区別します。公開済みタグの削除・移動・強制 push は行いません。元の未コミット変更や他の worktree は保持し、勝手に stash・reset・破棄しません。

## 2. 専用 worktree でリリースを準備する

```powershell
git worktree add $releaseWorktree -b $releaseBranch origin/main
Set-Location $releaseWorktree
```

同じ作業のブランチ・worktree が既にある場合は、その状態と関連 PR を確認して再開します。`main` へ直接コミットしません。対象 SHA、PR、CI、タグ、公開結果、後片付けの状態は作業記録に残します。記録は Git 管理外の `output/` などへ保存し、PR に混ぜません。

次のアプリケーションバージョンをすべて同じ `X.Y.Z` に揃えます。

| ファイル | 更新箇所 |
|---|---|
| `package.json` | ルートの `version` |
| `package-lock.json` | ルートと `packages[""]` の `version`（2 箇所） |
| `src-tauri/Cargo.toml` | `[package]` の `version` |
| `src-tauri/Cargo.lock` | `name = "maca-editor"` のパッケージレコードだけ |
| `src-tauri/tauri.conf.json` | `version` |

依存ライブラリや独立した workspace パッケージのバージョンを、アプリの番号へ一括置換しないでください。README の最新リリース紹介も更新します。

## 3. リリース概要を日本語で用意する

**GitHub Release の概要（本文）は日本語で書きます。Release タイトルの `MaCa Editor vX.Y.Z` を本文に重複して記載しません。** 技術名、製品名、コード、リンクには必要に応じて英語を使えます。

概要の原稿は `docs/releases/vX.Y.Z.md` に保存し、リリース準備 PR に含めます。[v2.5.0 の概要](releases/v2.5.0.md) を参考にしてください。

Release ワークフローは対象タグの原稿を読み込み、各 OS の公開ジョブへ同じ本文を渡します。原稿が存在しない、空欄、日本語を含まない、Release タイトルを重複記載している場合は、ビルド前の検証ジョブで失敗します。原稿は必ずタグを付ける前にコミットしてください。手動起動でも原稿は指定タグから取得します。

- 冒頭の 1〜2 文で、利用者にとって何が変わるか説明する。
- 新機能、修正、安全性、互換性、必要な移行、既知の制約を変更に応じて記載する。
- 実行した検証と、その範囲を正確に記載する。ビルド成功を GUI 実機確認済みと扱わない。
- 前バージョンとの変更一覧や、必要な使い方・サンプルへリンクする。
- 自動生成された英語の変更一覧だけを、日本語概要の代わりにしない。

本文の例です。先頭にリリース名の見出しを追加しません。

```markdown
今回の主な変更を、利用者向けに日本語で説明します。

## 新機能・修正

- 主な変更と利用者への影響。

## 互換性・制約

- 必要な移行や、未対応の範囲。

## 検証

実施したテスト・ビルド・実機確認と、未確認の範囲。
```

## 4. 検証し、PR を作成・マージする

```powershell
npm ci
npm run check:architecture
npm test
npx playwright install --only-shell chromium
npm run test:browser
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
git diff --check
```

Linux のブラウザーテストで OS 依存が不足する場合は、CI と同様に Playwright の `--with-deps` を利用します。バージョンの全 6 定義が一致し、lockfile の変更が意図したアプリの更新に限られることを差分で確認します。

変更をコミット・push して `main` 向けの PR を作成し、最新 head に対する frontend・Rust Windows・Rust Linux の全 CI を確認します。失敗は原因を調べ、テストの削除・無効化や保護要件の迂回で成功扱いにしません。再実行した場合は、その理由と最終結果を記録します。

PR の repository、base、head SHA、競合、必須チェック、レビュー要件をマージ直前に再確認します。検証後に head が変わっていないことを条件に、許可された通常の方式でマージします。

```powershell
# 作成した PR 番号を設定する
$releasePr = 123
$releaseHead = (gh pr view $releasePr --repo $releaseRepo --json headRefOid --jq '.headRefOid').Trim()
gh pr checks $releasePr --repo $releaseRepo
if ($LASTEXITCODE -ne 0) { throw 'CI が未完了または失敗しています' }
gh pr view $releasePr --repo $releaseRepo --json baseRefName,headRefName,headRefOid,mergeable,mergeStateStatus,reviewDecision
gh pr merge $releasePr --repo $releaseRepo --merge --match-head-commit $releaseHead
if ($LASTEXITCODE -ne 0) { throw 'マージ結果を確認してください' }
$releaseMerge = gh pr view $releasePr --repo $releaseRepo --json mergeCommit --jq '.mergeCommit.oid'
if ($LASTEXITCODE -ne 0 -or $releaseMerge -notmatch '^[0-9a-f]{40}$') { throw 'マージコミットを取得できません' }
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'リモートを取得できません' }
git merge-base --is-ancestor $releaseMerge origin/main
if ($LASTEXITCODE -ne 0) { throw '対象コミットが main に含まれていません' }
git diff --exit-code $releaseMerge $releaseHead
if ($LASTEXITCODE -ne 0) { throw 'マージ結果と検証済み head が一致しません' }
```

マージ結果の tree と検証済み head が一致すること、対象が `main` に含まれることを確認します。マージ後の Checks も追跡し、PR CI の結果と区別して記録します。

## 5. 検証済みコミットへタグを付ける

作成するタグがローカル・リモートの両方に存在しないことを再確認し、確認済みのマージ SHA を明示して注釈タグを作成します。

```powershell
$releaseExistingLocal = git tag --list $releaseTag
$releaseExistingRemote = git ls-remote --tags origin "refs/tags/$releaseTag"
if ($LASTEXITCODE -ne 0 -or $releaseExistingLocal -or $releaseExistingRemote) {
  throw '既存タグがあるか、リモートを確認できません'
}
git tag -a $releaseTag $releaseMerge -m "MaCa Editor $releaseTag"
if ($LASTEXITCODE -ne 0) { throw 'タグを作成できませんでした' }
git push origin "refs/tags/$releaseTag"
if ($LASTEXITCODE -ne 0) { throw 'タグの push 結果を確認してください' }
git rev-parse "$releaseTag^{}"
git ls-remote --tags origin "refs/tags/$releaseTag*"
```

タグが意図したコミットを指すことを確認します。`v*` タグの push で Release ワークフローが起動します。安定版タグには `-rc` などの接尾辞を付けません。現在のワークフローは `-` を含むタグを prerelease として扱います。

## 6. 全 OS の公開ビルドを追跡する

```powershell
gh run list --repo $releaseRepo --workflow release.yml --limit 5
# 対象タグ・SHA と一致する run ID を設定する
$releaseRunId = 123456789
gh run view $releaseRunId --repo $releaseRepo --json headSha,status,conclusion,jobs
```

原稿検証、Windows、macOS（Apple Silicon）、Linux の **3 ビルドジョブ**、最後の **公開本文の照合ジョブ** がすべて成功したことを確認します。現行ワークフローは最初のビルドジョブが公開処理に達した段階で Release が公開されるため、ページが存在するだけでは配布完了と判断できません。

失敗時はログを調べ、修正または必要なジョブだけの再実行を行います。成功済み配布物やタグを無断で削除・差し替えず、結果が不明なら状態を照会してから再操作します。

```powershell
gh run view $releaseRunId --repo $releaseRepo --log-failed
gh run rerun $releaseRunId --repo $releaseRepo --failed
```

ワークフロー側の修正が必要な場合も専用 PR で対応します。現行 Release ワークフローには、既存タグを `main` のワークフロー定義でビルドする手動起動もあります。対象ソースは入力したタグです。新しい run ID と対象 SHA を照合してください。

```powershell
gh workflow run release.yml --repo $releaseRepo --ref main -f "tag=$releaseTag"
```

## 7. 自動反映された日本語概要を確認する

**通常は手動で本文を設定する必要はありません。** `docs/releases/<タグ名>.md` の日本語概要をすべての公開ジョブに `releaseBody` として渡し、`generateReleaseNotes: false` で自動生成本文を無効にしています。全ビルド終了後の `Verify published Japanese release notes` が GitHub API から本文を読み戻し、原稿との一致を確認します（改行コードと前後の空白は正規化）。同じタグのワークフローは並行実行しません。

v2.5.0 では後続の公開ジョブで概要が空欄に戻る挙動を確認しました。各ジョブが同じ原稿を設定することで、再実行時も空欄で上書きされることを防ぎます。

照合が失敗した場合は、対象タグの原稿、公開本文、実行中の他の公開処理を確認します。原稿を直すために公開済みタグを移動しません。公開後の文章修正などで手動復旧が必要な場合だけ、全公開ジョブ終了後に承認された原稿を設定します。

```powershell
gh release edit $releaseTag --repo $releaseRepo `
  --title "MaCa Editor $releaseTag" `
  --notes-file "docs/releases/$releaseTag.md" `
  --draft=false --prerelease=false --latest

gh release view $releaseTag --repo $releaseRepo --json name,body,isDraft,isPrerelease,url
```

`--latest` は今回を最新版にする場合に指定します。旧バージョン系列の公開では省き、既存の最新版を意図せず戻さないよう確認してください。

公開ジョブの再実行では対象タグの原稿が再反映されます。公開後に手動で修正した本文がある場合は、その差分を確認してから再実行してください。再実行後も照合ジョブの成功と公開ページを確認します。

API から本文を読み戻し、日本語の原稿と一致することを確認します。さらに公開ページを開き、再読み込み後も次を確認してください。画面確認できない場合は、API 確認だけであることを記録します。

- 概要が空欄でなく、日本語で表示されている。
- ページの Release タイトルと同じタイトルが本文に重複していない。
- 見出し・箇条書き・コード・リンクが正しく表示されている。
- stable release として公開され、意図した場合に Latest になっている。

## 8. 配布物と完了状態を確認する

現行の構成では、次の **7 ファイル** が必要です。対象 OS や配布形式を変えた場合は、この一覧も更新します。

| 対象 | 配布物 |
|---|---|
| Windows x64 | `x64-setup.exe`、`x64_en-US.msi` |
| macOS Apple Silicon | `aarch64.dmg`、`aarch64.app.tar.gz` |
| Linux x86-64 | `amd64.AppImage`、`amd64.deb`、`x86_64.rpm` |

ファイル名のバージョン・アーキテクチャ、アップロード完了、サイズが 0 でないこと、ダウンロード可能なことを確認します。少なくとも利用可能な OS の配布物を取得し、取得したファイルの SHA-256 を GitHub の asset digest と照合し、インストーラー内部のバージョンも確認します。インストールや GUI 実機確認を行っていなければ、行ったと報告しません。

```powershell
gh release view $releaseTag --repo $releaseRepo --json tagName,assets,isDraft,isPrerelease,url
gh api "repos/$releaseRepo/releases/latest" --jq '.tag_name'
```

Windows の MSI は、実行・インストールせずに内部バージョンを照会できます。取得先は今回の作業用ディレクトリとし、既存ファイルを無条件に上書きしません。

```powershell
$releaseAssetsDirectory = Join-Path $releaseRoot "output/releases/$releaseTag/assets"
New-Item -ItemType Directory -Force -Path $releaseAssetsDirectory | Out-Null
gh release download $releaseTag --repo $releaseRepo --pattern '*_x64_en-US.msi' --dir $releaseAssetsDirectory
$releaseMsiFiles = @(Get-ChildItem -LiteralPath $releaseAssetsDirectory -Filter '*.msi')
if ($releaseMsiFiles.Count -ne 1) { throw '対象 MSI を一意に特定できません' }
Get-FileHash -LiteralPath $releaseMsiFiles[0].FullName -Algorithm SHA256
$releaseInstaller = New-Object -ComObject WindowsInstaller.Installer
$releaseDatabase = $releaseInstaller.OpenDatabase($releaseMsiFiles[0].FullName, 0)
$releaseView = $releaseDatabase.OpenView('SELECT `Value` FROM `Property` WHERE `Property` = ''ProductVersion''')
$releaseView.Execute()
$releaseRecord = $releaseView.Fetch()
$releaseMsiVersion = $releaseRecord.StringData(1)
$releaseView.Close()
if ($releaseMsiVersion -ne $releaseVersion) { throw 'MSI のバージョンが一致しません' }
```

PR CI、マージ後 CI、Release の 3 OS ビルド、日本語概要、全配布物の確認を終えてから公開完了とします。記録にはリリース URL、タグのコミット、各 run ID、配布物と検証結果、未確認事項を残します。

## 9. 後片付けと報告

専用 worktree の絶対パス・ブランチ・HEAD・クリーン状態と、その変更がマージ済みであることを照合します。worktree の外側から `git worktree remove` を実行し、その後に今回のローカル／リモート作業ブランチだけを削除します。`--force` や無条件の再帰削除で押し切りません。残った内容があれば確認し、Git 登録一覧と実ディレクトリの両方で削除結果を検証します。

元の未コミット変更と他の worktree は保持します。元の `main` を更新する場合も、安全に fast-forward できることを確認します。公開したリリース・タグは後片付けで削除しません。

最後にリリース URL、主な変更、各 CI・配布物確認の結果、PR／マージコミット、作業用 worktree／ブランチの整理結果、残る制約を報告します。途中で止まった場合は、公開済みの範囲と残作業を明確にします。
