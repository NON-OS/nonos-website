---
title: "Exception and IRQ Handlers"
description: "Past the trampoline, each vector runs a Rust handler."
weight: 3
---
Past the trampoline, each vector runs a Rust handler. The exception handlers decide whether a
fault is recoverable and, if not, whether it kills the offending capsule or halts the kernel;
the IRQ handlers run the device work and acknowledge the controller. This page documents both,
and the shared interrupt-context and end-of-interrupt handling. The code is under
`src/interrupts/handlers/`.

## The page fault

The page fault handler ([`src/interrupts/handlers/exceptions/page_fault.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/interrupts/handlers/exceptions/page_fault.rs#L31)) is the busiest
and the most consequential, because demand paging routes every lazily-backed page through it.
It reads the faulting address from `CR2`, decodes the error code, and tries to handle the
fault before treating it as an error:

```
  handle(frame, error_code):
      addr = CR2
      increment page-fault stat
      if try_handle_fault(addr, error_code):  return   // handled, silent
      dump the trap, log it
      if fault came from user mode:  terminate_user_process()   // SIGSEGV-equivalent
      else:                          kernel_panic()             // halt
```

`try_handle_fault` (`page_fault.rs:60`) first asks the [hardening](/docs/subsystems/memory/hardening/)
layer whether the address is a guard page, in which case it refuses to handle it and lets the
fault escalate, and otherwise hands it to the [paging manager](/docs/subsystems/memory/faults/), which
performs demand backing or copy-on-write and returns success if it resolved the fault. A
handled demand fault returns silently and is not dumped, deliberately: dumping every lazily
backed page to the serial console would make a large allocation pathologically slow as it
faults in page by page. Only an unhandled fault is logged, and its disposition depends on
where it came from, a user-mode fault terminates that process with an error and yields, while
a kernel-mode fault is unrecoverable and halts. The logged address is passed through
`redact_address` so a fault log does not leak a raw kernel pointer.

## The double fault

The double fault handler ([`exceptions/double_fault.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/exceptions/double_fault.rs#L24)) runs on its own IST stack, since a
double fault often means the normal stack is unusable, and it does not attempt recovery: it
logs the frame and the error code, dumps the stack and instruction pointers (redacted), and
halts. A double fault is the CPU telling the kernel it could not deliver a prior fault, so
continuing is not meaningful; the handler's job is to leave a legible record and stop. The
remaining exception handlers, invalid TSS, segment-not-present, and the arithmetic and opcode
faults, follow the same shape at lower severity, classified by `exception_is_fatal`.

## The IRQ handlers

The IRQ handlers are lighter. Each sets the interrupt context, does its device work, updates a
stat, and sends the end-of-interrupt:

- **Timer** is the exception to "light": its body is `on_timer_interrupt`, which drives the
  100 Hz [scheduler tick](/docs/subsystems/scheduler/preemption/), and it is reached through the
  [timer trampoline](/docs/subsystems/interrupts/trampolines/) that also snapshots the preempted capsule.
- **Keyboard** and **mouse** ([`handlers/irq/keyboard.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/irq/keyboard.rs#L26)) set the interrupt context,
  increment their counter, and acknowledge. The microkernel build carries no in-kernel
  scancode pipeline, the PS/2 path lives in a driver capsule, so the kernel handler only has
  to keep the IDT slot resolvable and ack the line; the real input path is the
  [input subsystem](/docs/subsystems/input/).
- **Syscall** ([`handlers/irq/syscall.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/irq/syscall.rs#L19)) is the legacy `int 0x80` counter; the live
  syscall path is the `SYSCALL` instruction documented on the [syscall boundary](/docs/subsystems/syscall/boundary/).

## Interrupt context and the end-of-interrupt

Two things are shared across every handler. First, each takes an interrupt-context guard at
entry via `set_interrupt_context`, which bumps a per-CPU nesting depth; the
[safety](/docs/subsystems/interrupts/safety/) page covers what that guards against. Second, each ends by acknowledging
the interrupt to the live controller (`keyboard.rs:38`):

```
  send_eoi():
      if apic::is_enabled():  apic::send_eoi()          // preferred
      else:                   pic::send_eoi(irq_line)    // legacy fallback
```

The kernel runs on the local APIC when it is up and falls back to the 8259 PIC otherwise, and
every handler routes its acknowledgement through the same choice so the two controllers never
disagree about whether a line was serviced. The [controllers](/docs/subsystems/interrupts/controllers/) page documents
both.

## Security analysis

The handlers are where a fault's disposition is decided, and the security question is whether a
userspace fault can ever be mistaken for a kernel one, or a fault log leak something it should not.
Three properties answer that.

**Fail-closed by origin.** The page-fault handler branches on `exception.is_user_mode()`, which reads
the low two bits of the saved `CS` (`context.rs:40`). A fault that is not handled by demand paging and
came from ring 3 calls `terminate_user_process`, which exits the offending capsule with `-11` (the
SIGSEGV-equivalent) and yields (`page_fault.rs:76`); a fault from ring 0 calls `kernel_panic` and halts.
The kernel never tries to "recover" a userspace fault by patching around it, and it never continues past
its own unrecoverable fault. The guard-page check runs first and deliberately *refuses* to handle
(`try_handle_fault` returns false after logging `"Guard page violation detected"`), so a stack or heap
overrun into a guard page escalates rather than being silently backed, which is the whole point of the
[hardening](/docs/subsystems/memory/hardening/) guard pages.

**Fault logs are redacted.** Every address a handler prints goes through `redact_address`
(`page_fault.rs`, `double_fault.rs`, `context.rs`), so a page-fault or double-fault log leaves a legible
record without spilling a raw kernel pointer into the serial log, which would hand an attacker with log
access a KASLR oracle. The faulting `CR2`, the instruction pointer, and the stack pointer are all
redacted in the logged line; the raw values still reach the low-level `dump_trap` used for local
bring-up, which is a developer-console tool, not the structured log.

**The double fault is terminal and says so.** `double_fault::handle` returns `!` and ends in
`halt_loop` after printing `"SYSTEM HALTED: Double fault is unrecoverable"` (`double_fault.rs:33`). A
double fault means the CPU could not deliver a prior fault, so the handler's contract is to leave a
record and stop rather than attempt a recovery that cannot be sound. It runs on its own IST stack (set
in the [IDT](/docs/subsystems/interrupts/idt/)) exactly because the normal stack is often what is broken. The honest boundary is
that the lighter exception handlers (invalid TSS, segment-not-present, the arithmetic and opcode faults)
share the same classify-and-log shape but are less battle-tested than the page-fault path, since demand
paging exercises `#PF` on every boot while those vectors fire rarely.

## Debugging exceptions

The console (serial, or the framebuffer on a `NONOS_FBCONSOLE=1` build) is the whole debugging surface,
and an unhandled fault prints two things: the low-level trap line from `dump_trap`, then the structured
critical log. The trap line names the vector and the full frame:

```
  [TRAP PF] cpl=… rip=… rsp=… cs=… ss=… rflags=… cr3=… asid=… pid=… err=… cr2=…
```

Read that line first. `cpl=3` means a capsule faulted and (if unhandled) was terminated; `cpl=0` means
the kernel faulted and halted. `cr2=` is the faulting address, `pid=` and `asid=` say which capsule and
address space were live, and `err=` is the page-fault error code. The structured log then adds
`"PAGE FAULT: addr=… err=… rip=… rsp=…"` (redacted) and, on a kernel panic, one of three plain-language
lines decoded from the error code (`page_fault.rs:90`): `"Attempted to execute from non-executable
page"` when the instruction-fetch bit is set, `"Attempted to write to read-only page"` when the write
bit is set, otherwise `"Attempted to read from non-present page"`. That triple turns a bare address into
a cause: an execute fault on a data page is a control-flow-integrity event, a write fault on a
read-only page is a bad mapping or a clobbered `.got` (the [capsule RELRO](/docs/subsystems/process/) story),
and a non-present read is the ordinary shape of a genuinely bad pointer.

One thing the console will *not* show is a successfully handled demand fault. `try_handle_fault` returns
before any dump (`page_fault.rs:42`), so a lazily-backed page is silent by design; dumping every one
would make a large allocation crawl as it faults in page by page. So the absence of `[TRAP PF]` under a
heavy allocation is correct, and its presence always means the fault was *not* a normal demand fault.
For a double fault the record is `log_exception("DOUBLE FAULT", …)`, the `"Double fault error code:"`
line, the redacted stack and instruction pointers from `dump_stack_info`, and the halt banner; a double
fault whose reported stack pointer sits in an unexpected IST region points back at the IST assignment in
the [IDT](/docs/subsystems/interrupts/idt/), not at the handler.

## Source map

```
  src/interrupts/handlers/exceptions/page_fault.rs   demand/guard/terminate-vs-panic
  src/interrupts/handlers/exceptions/double_fault.rs the unrecoverable halt
  src/interrupts/handlers/exceptions/context.rs      ExceptionContext, error-code decode, logging
  src/interrupts/handlers/irq/                        timer, keyboard, mouse, syscall
  src/arch/x86_64/diag/dump_trap.rs                  the low-level [TRAP …] serial line
```

Every reference above is verified against those trees. The trampoline that swapgs-es and captures state
before these handlers run is on the [trampolines](/docs/subsystems/interrupts/trampolines/) page, the interrupt-context guard each
handler takes is on the [safety](/docs/subsystems/interrupts/safety/) page, the EOI gate at the tail is on the
[controllers](/docs/subsystems/interrupts/controllers/) page, and the guard pages the page-fault path refuses to back are on the
[memory hardening](/docs/subsystems/memory/hardening/) page.
