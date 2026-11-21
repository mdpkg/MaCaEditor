# Local security backport

This directory contains the crates.io `glib` 0.18.5 release, with its original
version, MIT license, and copyright notices preserved. Cargo's `[patch.crates-io]`
in `src-tauri/Cargo.toml` selects this copy for the transitive GTK3 dependencies.
The registry source and Cargo cache must not be modified.

Original crate archive SHA-256 (from the crates.io lockfile):
`233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`.

## RUSTSEC-2024-0429

In `src/variant_iter.rs`, make the output pointer in `VariantStrIter::impl_get`
mutable and pass `&mut p` to `g_variant_get_child` instead of `&p`. This removes
the undefined behavior caused by writing through a shared reference. There is no
public API change.

Sources:

- Advisory: https://rustsec.org/advisories/RUSTSEC-2024-0429.html
- Upstream fix: https://github.com/gtk-rs/gtk-rs-core/commit/b5a4071e439bef2b5eea76c3aa25e5ae84839e34
- Debian backport: https://sources.debian.org/patches/rust-glib-0.18/0.18.5-7/0007-glib-fix-UB-in-VariantStrIter-impl_get.patch/

The only changes to the published crate are the two-line fix, an additional
`test_variant_str_iter_soundness_regression` unit test, and this document.
The Cargo installation marker `.cargo-ok` is omitted.

## Verification and maintenance

On Linux with the GLib development libraries installed, run:

```sh
cargo test --manifest-path src-tauri/vendor/glib/Cargo.toml --release --lib variant_iter
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
```

The release-mode tests are essential: the original bug can surface only when
compiler optimizations are enabled. The additional test covers all five affected
iterator methods, empty strings, and Unicode strings. The Linux CI job also
checks that Cargo actually resolves `glib` to this directory.

On 2026-11-21, the 12 filtered tests passed on Ubuntu 24.04 / WSL with Rust 1.99.1
and GLib 2.80.0. An isolated copy with the two-line fix reverted crashed with
SIGSEGV in the additional regression test under the same release profile.

`cargo-audit` 0.23 skips path and Git packages when matching RustSec advisories.
A clean audit alone therefore does not validate this copy. Review the source
diff and keep running the release-mode regression test. Future advisories for
glib 0.18.5 must still be reviewed manually while this copy is maintained.

Remove this override and vendored crate once the supported Tauri dependency
graph uses a fixed upstream glib release throughout. Track the GTK 0.19 migration
at https://github.com/tauri-apps/tauri/pull/16170.
