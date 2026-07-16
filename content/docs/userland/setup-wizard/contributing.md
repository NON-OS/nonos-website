---
title: "Contributing to capsule_setup_wizard"
description: "This page is for a contributor who wants to change the wizard."
weight: 7
---
This page is for a contributor who wants to change the wizard. It covers where the source lives, which
folder owns which behaviour, the exact steps to add a wizard step, how to build and sign the capsule, and
the code standards a change has to meet. For what the wizard does and how it is put together, read the
[README](/docs/userland/setup-wizard/), the [step reference](/docs/userland/setup-wizard/steps/), the [state machine](/docs/userland/setup-wizard/state-machine/), and the
[policy writes](/docs/userland/setup-wizard/policy-writes/) pages in this folder.

## Where the source lives

The capsule is at `userland/capsule_setup_wizard/`. It is a `no_std`/`no_main` compositor-surface runner,
not an app-skeleton app: `_start` initialises the heap, runs `setup::run` to bring up the surface, and
hands the `Context` to `server::runner::run`, which owns the key loop and never returns ([`src/main.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L16)).
The top-level modules are declared there ([`src/main.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L6)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/render/screens/` | one file per step: `draw` and `on_key` | you add or change a step |
| `src/render/widgets/` | the reusable list, toggle, masked-field, and progress widgets | you change how a step is drawn |
| `src/render/` (`mod.rs`, `chrome.rs`, `theme.rs`, `paint.rs`) | the frame, the left rail, the palette, the draw primitives | you change the chrome or the step labels |
| `src/server/` | the step counter (`step.rs`) and the key loop (`runner.rs`) | you change sequencing, the global keys, or the loop |
| `src/setup/` | service discovery and surface bring-up | you change bring-up or the required services |
| `src/clients/` | the compositor, display-info, input-router, and policy IPC clients | you change an outbound call |
| [`src/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs) | `Context`, the whole model | you add a selection field |

## Adding a step

There are four edits, and the two dispatch tables in [`screens/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/screens/mod.rs) are the load-bearing ones.

1. Write the screen module as one file under `src/render/screens/`, exposing
   `pub fn draw(ctx: &Context)` that paints through `render::frame` plus a widget, and
   `pub fn on_key(ctx: &mut Context, code: u32) -> Outcome` that handles the step's keys and falls back to
   `default_key` for Enter and Escape. Follow [`src/render/screens/network.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/network.rs) for a list step,
   [`src/render/screens/privacy.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/privacy.rs) for a toggle step, or [`src/render/screens/admin.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/admin.rs) for a text field.

2. Add any new selection field to `Context` and its default in `Context::new` ([`src/state.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L1),
   [`src/state.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L39)).

3. Register the module and wire both dispatch arms: add the `pub mod` line
   ([`src/render/screens/mod.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/mod.rs#L1)), add the `draw` arm keyed on the new step number
   ([`src/render/screens/mod.rs:15`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/mod.rs#L15)) and the matching `on_key` arm ([`src/render/screens/mod.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/mod.rs#L31)), add the
   step label to `STEP_LABELS` ([`src/render/theme.rs:15`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/theme.rs#L15)), and raise `DONE` in [`src/server/step.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/step.rs#L1) so
   the machine runs the new step before review. The step numbers in the two match blocks, the order of
   `STEP_LABELS`, and `DONE` must stay in agreement.

4. If the choice should persist, add its `Field` to the shared enum
   ([`userland/policy_proto/src/field.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/field.rs#L19)) and a matching `set_*` call to the review `commit`
   ([`src/render/screens/review.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/review.rs#L26)); the write only lands because the wizard is a trusted policy setter
   ([`userland/capsule_policy/src/server/handle_set.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/handle_set.rs#L23)). Note that several fields today are collected
   without a `set_*` call; the [policy writes page](/docs/userland/setup-wizard/policy-writes/) lists those gaps, and closing one is
   just adding the call here.

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk:156` and pulled in through
`userland/capsule_setup_wizard/Capsule.mk:18`. The `setup-wizard` slug comes from `Capsule.mk:6`.

```
  make nonos-mk-setup-wizard             build the capsule ELF                       capsule.mk:182
  make nonos-mk-setup-wizard-sign        id cert, manifest, attestation trailer      capsule.mk:261
  make nonos-mk-setup-wizard-verify      verify the signed artifacts vs trust anchor capsule.mk:263
  make nonos-mk-check-setup-wizard-keys  assert the per-capsule signing keys exist   capsule.mk:184
```

For a bootable first-run image:

```
  make nonos-mk-setup-wizard-prod         full desktop GUI kernel with the wizard in the fleet  Makefile:1099
  make nonos-mk-setup-wizard-esp          package that build into an ESP                        Makefile:1151
  make nonos-mk-run-wizard                boot the first-run wizard in QEMU under OVMF          Makefile:1298
  make nonos-mk-setup-wizard-inject-prod  layer the input-probe inject feature for on-HW input Makefile:1121
```

The `-prod` profile builds under the `microkernel-setup-wizard` feature, which is the feature the
orchestrator gates the first-run spawn ordering on (`Makefile:1099`,
[`src/userspace/init/spawn_plan/orchestrator.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/orchestrator.rs#L55)).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every client call returns a `Result` the
  wizard either acts on or discards with `let _ =`, never a panic ([`src/render/screens/review.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/review.rs#L26),
  [`src/server/runner.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L13)).
- One unit per file. Screens are one step per file under `src/render/screens/`, widgets one per file under
  `src/render/widgets/`, and `mod.rs` is used only for module declarations and re-exports
  ([`src/render/screens/mod.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/mod.rs#L1), [`src/clients/compositor/mod.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/compositor/mod.rs#L25)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/setup/fill.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/fill.rs#L1) and every other module.

## Source map

```
  src/main.rs                     _start -> setup::run -> server::runner::run; the module list
  src/render/screens/mod.rs       the two dispatch tables to wire a new step into
  src/render/screens/network.rs   a list-step template
  src/render/screens/privacy.rs   a toggle-step template
  src/render/screens/admin.rs     a text-field template
  src/render/screens/review.rs    the commit, where a persisted field gets its set_* call
  src/render/theme.rs             STEP_LABELS, kept in agreement with the step numbers
  src/server/step.rs              DONE and the step counter
  src/state.rs                    Context and Context::new, where a new selection field goes
  userland/policy_proto/src/field.rs                    the shared Field enum
  userland/capsule_policy/src/server/handle_set.rs      the two-name policy write gate
  Capsule.mk                      slug, ports, mask; includes the generated per-slug targets
  nonos-mk/capsule.mk             the nonos-mk-setup-wizard[-sign|-verify] target template
  Makefile                        the -prod, -esp, run-wizard, and inject-prod image targets
```

Every reference above is verified against those trees.
</content>
