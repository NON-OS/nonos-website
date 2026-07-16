---
title: "The I2C transfer engine"
description: "This page covers the polled master transfer that OPTRANSFER and OPPROBE drive: the address and length checks, the enable/disable bracket around a transaction, and the four-phase..."
weight: 3
---
This page covers the polled master transfer that `OP_TRANSFER` and `OP_PROBE` drive: the address and
length checks, the enable/disable bracket around a transaction, and the four-phase engine loop with its
timing budget. It mirrors `src/transaction/`, split into `control/`, `engine/`, and `types/`. For the
request handlers that call in see [operations.md](/docs/userland/driver-i2c-pci/operations/); for the bring-up that programs the
clock this engine relies on see [bring-up.md](/docs/userland/driver-i2c-pci/bring-up/).

## Request and result types

A transfer is described by `TransferRequest`: a 7-bit address, a `u16` flags word, a borrowed write
slice, and a read length ([`src/transaction/types/transfer_request.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/types/transfer_request.rs#L16)). The one defined flag is
`FLAG_RESTART_ON_READ` (bit 0, [`src/transaction/types/flags.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/types/flags.rs#L16)). The result is `TransferResult`: a
fixed 64-byte read buffer, the number of bytes actually read, and the DesignWare abort source latched on
a NACK ([`src/transaction/types/transfer_result.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/types/transfer_result.rs#L18), [`src/transaction/types/result_empty.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/types/result_empty.rs#L21)).
`TransferError` is the four-way failure enum the handlers map to errnos: `Busy`, `Timeout`, `Nack`,
`Invalid` ([`src/transaction/types/transfer_error.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/types/transfer_error.rs#L16)).

## The transaction bracket

`transfer` brackets the engine with controller state changes ([`src/transaction/engine/transfer.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/transfer.rs#L21)).
It first validates the address against `0x7F` and the write/read lengths against 64 via `valid_lengths`,
returning `Invalid` on either ([`src/transaction/engine/transfer.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/transfer.rs#L25),
[`src/transaction/types/valid_lengths.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/types/valid_lengths.rs#L18)). Then it waits for the master to go idle, sets the target
address, enables the controller, runs the engine, and disables the controller again regardless of the
engine's outcome ([`src/transaction/engine/transfer.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/transfer.rs#L29), `transfer.rs:33`).

The control helpers under `src/transaction/control/` are each one file:

- `wait_idle` spins on `IC_STATUS` master-activity and returns `Busy` if the master never goes idle
  ([`src/transaction/control/wait_idle.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/control/wait_idle.rs#L20), `wait_idle.rs:27`).
- `set_target` disables the controller if it is currently enabled, writes the 7-bit address to `IC_TAR`,
  and re-enables it ([`src/transaction/control/set_target.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/control/set_target.rs#L23)). The address change requires the
  controller disabled, which is why it brackets the write.
- `enable` writes `IC_ENABLE` and waits for the enable-status bit to reach 1; `disable` writes 0 and waits
  for it to reach 0; both time out with `Timeout` otherwise ([`src/transaction/control/enable.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/control/enable.rs#L23),
  [`src/transaction/control/disable.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/control/disable.rs#L22), [`src/transaction/control/wait_enable_state.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/control/wait_enable_state.rs#L20)).

## The engine loop

The engine itself is `run` ([`src/transaction/engine/run.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/run.rs#L28)). It computes the total command count as
`write.len() + read_len` and loops up to `TIMEOUT_ITERS` (250,000, [`src/constants/mod.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L62)) times over
four phases:

1. **Abort check.** If `IC_RAW_INTR_STAT` shows the TX-abort bit, it latches `IC_TX_ABRT_SOURCE` into the
   result, reads `IC_CLR_TX_ABRT` to clear, and returns `Nack` ([`src/transaction/engine/check_abort.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/check_abort.rs#L20),
   `check_abort.rs:24`). This is the NACK path.
2. **Drain RX.** While the RX FIFO is not empty (`IC_STATUS` RFNE bit) and read bytes remain, it pops the
   low byte of `IC_DATA_CMD` into the read buffer ([`src/transaction/engine/drain_rx.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/drain_rx.rs#L20)).
3. **Issue commands.** While commands remain and both the TX and RX FIFOs have space, it issues one
   command word per iteration: a write byte for the write phase (`take_write`,
   [`src/transaction/engine/take_write.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/take_write.rs#L16)), or a read command for the read phase (`read_cmd`,
   [`src/transaction/engine/read_cmd.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/read_cmd.rs#L19)), and tags the final command with `IC_DATA_CMD_STOP`
   ([`src/transaction/engine/run.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/run.rs#L36), `run.rs:42`). A repeated-start is set on the first read after a
   write only when `FLAG_RESTART_ON_READ` is present ([`src/transaction/engine/read_cmd.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/read_cmd.rs#L20)). FIFO space
   is computed against a fixed 64-entry depth ([`src/transaction/engine/tx_space.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/tx_space.rs#L19),
   [`src/transaction/engine/rx_space.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/rx_space.rs#L19), [`src/constants/mod.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L63)).
4. **Completion.** Once every command has been issued and every expected read byte drained, `done` checks
   that the TX FIFO is empty and the master is no longer active, and the engine returns the result
   ([`src/transaction/engine/run.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/run.rs#L48), [`src/transaction/engine/done.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/done.rs#L19)). If the budget runs out
   first, it returns `Timeout` ([`src/transaction/engine/run.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/run.rs#L54)).

## Probe

`probe` is a one-byte read transfer whose outcome is folded to a boolean: `Ok` maps to present, a `Nack`
maps to absent, and any other error propagates ([`src/transaction/engine/probe.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/probe.rs#L21)). This is what lets
`OP_PROBE` distinguish "nobody home" from a real bus fault.

## The polled gap

This is the engine's honest limit, and the source is explicit about it. The engine is polled, not
interrupt-driven. The IRQ is bound and acked once at bring-up so the interrupt line does not stay
asserted ([`src/setup/sequence.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L16)), but transfers busy-wait on FIFO status inside the fixed 250,000
iteration budget rather than blocking on the interrupt ([`src/transaction/engine/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/run.rs#L32)). The transfer
buffers are small and controller-local (64 bytes each), and every wait has a finite budget
([`src/transaction/control/wait_idle.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/control/wait_idle.rs#L21), [`src/transaction/control/wait_enable_state.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/control/wait_enable_state.rs#L22)), so the
driver fails closed on a stuck bus with `Busy`, `Timeout`, or `Nack` rather than hanging. A client can
occupy the driver for up to the full budget per transfer; there is no preemption of an in-flight bus
transaction, and no interrupt-driven completion. Neither limit widens the capsule's authority.

## Source map

```
  userland/capsule_driver_i2c_pci/src/transaction/types/      TransferRequest/Result/Error, flags, valid_lengths
  userland/capsule_driver_i2c_pci/src/transaction/control/    wait_idle, set_target, enable, disable, wait_enable_state
  userland/capsule_driver_i2c_pci/src/transaction/engine/transfer.rs  the enable/disable bracket
  userland/capsule_driver_i2c_pci/src/transaction/engine/run.rs       the four-phase loop
  userland/capsule_driver_i2c_pci/src/transaction/engine/check_abort.rs  the NACK path
  userland/capsule_driver_i2c_pci/src/transaction/engine/drain_rx.rs     RX FIFO drain
  userland/capsule_driver_i2c_pci/src/transaction/engine/read_cmd.rs     read command + repeated-start
  userland/capsule_driver_i2c_pci/src/transaction/engine/take_write.rs   write command
  userland/capsule_driver_i2c_pci/src/transaction/engine/done.rs         completion check
  userland/capsule_driver_i2c_pci/src/transaction/engine/tx_space.rs     TX FIFO space
  userland/capsule_driver_i2c_pci/src/transaction/engine/rx_space.rs     RX FIFO space
  userland/capsule_driver_i2c_pci/src/transaction/engine/probe.rs        one-byte presence probe
  userland/capsule_driver_i2c_pci/src/constants/mod.rs                   TIMEOUT_ITERS, FIFO depths, command bits
```

Every reference above is verified against those trees.
