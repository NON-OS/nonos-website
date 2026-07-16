---
title: "Debugging capsule_setup_wizard"
description: "This page lists the log marker the wizard's boot path emits and the concrete failure modes with where to look for each."
weight: 8
---
This page lists the log marker the wizard's boot path emits and the concrete failure modes with where to
look for each. For the flow itself see the [README](/docs/userland/setup-wizard/), the [step reference](/docs/userland/setup-wizard/steps/), the
[state machine](/docs/userland/setup-wizard/state-machine/), and the [policy writes](/docs/userland/setup-wizard/policy-writes/) pages in this folder.

## The boot marker

The first thing to confirm is that the wizard ran. On a boot under the `microkernel-setup-wizard` feature
the orchestrator spawns the wizard through the shared capsule-boot path, and the `Ok` arm logs
`[SETUP-WIZARD] capsule spawned`: the prefix `SETUP-WIZARD` is passed at
[`src/userspace/init/spawn_plan/orchestrator.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/orchestrator.rs#L60), and `boot_log::ok(prefix, "capsule spawned")` prints
it ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29), [`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)).

An absent line means the capsule never started, usually a signature, manifest, or capability failure; the
`Err` arm logs a prefixed `[ERROR]` line built from the spawn error instead
([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32), [`src/userspace/init/capsule_boot/error.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/error.rs#L21),
[`src/sys/boot_log/output.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L49)).

## Failure modes

### The screen stays black or the wizard exits immediately

Bring-up aborts with a specific error string if a required service is missing or the display query fails.
Each stage of `setup::run` returns its own message, `_start` exits with code 2, and nothing is drawn: the
compositor or input-router lookup, the compositor health check, the display-info query, the backing mmap,
the surface register or share, or the scene submit or damage commit
([`src/setup/mod.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mod.rs#L18), [`src/setup/mod.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mod.rs#L22), [`src/setup/mod.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mod.rs#L31), [`src/setup/mod.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mod.rs#L45),
[`src/setup/mod.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mod.rs#L63), [`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)). The policy service is optional, so a missing policy does not
abort bring-up; it only skips the commit later ([`src/setup/discover.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/discover.rs#L30)).

### The wizard is on screen but ignores Enter or Escape

That is the keyboard grab failing, not the state machine wedging. The input router refuses a grab with
`E_ACCES` if the sender is not resolved as a trusted grabber, or `E_BUSY` if the keyboard is already held,
and the wizard then receives no key deliveries
([`userland/capsule_input_router/src/server/handlers/grab_request.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/handlers/grab_request.rs#L32), `grab_request.rs:49`,
[`src/server/runner.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L14)). The subscribe and grab return values are discarded, so the symptom is silence
rather than an error line ([`src/server/runner.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L13)). The loop also drops anything that is not a key-down,
so a stream of pointer events alone would look the same ([`src/server/runner.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L26)).

### Settings do not stick after first boot

The commit is skipped whole if the policy service was absent at discovery, because `policy_port` is then
`0` ([`src/render/screens/review.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/review.rs#L22), [`src/setup/discover.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/discover.rs#L30)). If policy is present but a specific
value is wrong, check the mapping in `commit`: the network step collapses to two booleans, and the timezone
and hostname fields have no UI in the current flow, so `Timezone` is always written `0` and `Hostname` is
never written ([`src/render/screens/review.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/review.rs#L28), `review.rs:35`). A rejected individual write returns a
non-zero policy status the wizard discards, so a single bad field fails silently rather than aborting the
commit ([`src/clients/policy.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/policy.rs#L13)). The [policy writes page](/docs/userland/setup-wizard/policy-writes/) lists every collected value
that has no `set_*` call, which is the usual reason a chosen value never appears in policy.

### The wizard finishes but the desktop does not appear

The wizard exiting is the trigger for the desktop fleet. The supervisor loop watches the wizard's shared
state and starts the desktop only once it is no longer alive; a wizard that completes disappears cleanly
via `mk_exit(0)` ([`src/userspace/init/supervisor/loop_impl.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/supervisor/loop_impl.rs#L36), [`src/server/runner.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L33),
[`src/userspace/init/spawn_plan/orchestrator.rs:67`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/orchestrator.rs#L67)). A wizard that hangs before review, most likely on a
grab that never succeeded, is holding the desktop back.

## Source map

```
  src/userspace/init/spawn_plan/orchestrator.rs   the SETUP-WIZARD prefix and the first-run ordering
  src/userspace/init/capsule_boot/run.rs          the ok/error boot-log arms
  src/userspace/init/capsule_boot/error.rs        the spawn-error message
  src/sys/boot_log/output.rs                      how ok/error lines are printed
  src/setup/mod.rs                                the bring-up stages and their error strings
  src/setup/discover.rs                           optional policy; policy_port = 0 on a miss
  src/main.rs                                     exit codes 1 (heap) and 2 (bring-up)
  src/server/runner.rs                            subscribe/grab discarded; key-down gate; mk_exit
  src/render/screens/review.rs                    the policy_port guard and the commit mapping
  src/clients/policy.rs                           the discarded per-field reply status
  src/userspace/init/supervisor/loop_impl.rs      the desktop-after-wizard trigger
  userland/capsule_input_router/src/server/handlers/grab_request.rs   E_ACCES / E_BUSY on grab
```

Every reference above is verified against those trees.
</content>
