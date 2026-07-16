---
title: "The calculator evaluation engine"
description: "There is no expression grammar and no operator precedence in this calculator."
weight: 4
---
There is no expression grammar and no operator precedence in this calculator. The engine is the classic
single-pending-operator model of a physical desk calculator: a display value, one pending operand, one
pending operator, and a memory register, all held in one `State`, with every arithmetic step a checked or
saturating integer operation that turns overflow into a typed error rather than a wrap or a panic. This
page mirrors [`src/calc/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/state.rs) (the machine), [`src/calc/fixed.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/fixed.rs) (the scale), [`src/calc/op.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/op.rs) and
[`src/calc/unary.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/unary.rs) (the arithmetic), `src/calc/actions/` (one file per operation), and
`src/calc/format/` (number to text). For how an input reaches these operations, see the
[input](/docs/userland/calculator/input/) page; for the overview see the [README](/docs/userland/calculator/).

## State: the whole machine

The entire calculator is four numbers plus two latches, held in one `State`
([`src/calc/state.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/state.rs#L28)):

| Field | Meaning | Source |
|---|---|---|
| `display` | the number currently shown and the number the next operation acts on | `state.rs:29` |
| `operand` | the left-hand side saved when an operator is pressed | `state.rs:30` |
| `operator` | the one pending operator, or `Op::None` | `state.rs:31` |
| `memory` | the independent memory register | `state.rs:32` |
| `new_input` | true when the next digit should start a fresh number rather than append | `state.rs:33` |
| `decimal_digits_typed` | how many fractional digits the user has entered, `0` while still on the integer part | `state.rs:34` |
| `error` | the error latch: `None`, `DivByZero`, `DomainError`, or `Overflow` | `state.rs:35`, `state.rs:20` |

There is no heap-held document, no history, and no shared static, so the whole state is a handful of
integers. `State::new` starts at zero with `new_input` set and no error (`state.rs:39`). Three helpers
carry the invariants every operation relies on: `memory_engaged` reports whether the register is non-zero
(it drives the on-screen badge, `state.rs:50`), `is_error` reports whether the latch is set (it is the
guard at the top of nearly every operation, `state.rs:53`), and `reset_input` sets `new_input` and clears
the fractional-digit count so the next digit starts a new number (`state.rs:56`).

## Fixed-point: i128 scaled by 1e8

Numbers are `i128` scaled by a fixed factor, so the display carries exactly eight fractional digits
([`src/calc/fixed.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/fixed.rs#L17)):

```
  type Fixed = i128;
  const FRAC: Fixed = 100_000_000;   // 1e8
  const MAX_FRACTION_DIGITS: u32 = 8;
```

A `Fixed` value of `250_000_000` is the number `2.5`; `FRAC` is the unit `1.0`. Every operation that
multiplies two scaled numbers has to divide the product back by `FRAC` to keep the scale, and every
operation that divides has to scale the numerator up by `FRAC` first. That bookkeeping lives entirely in
`op.rs` and `unary.rs`; the rest of the engine treats a `Fixed` as an opaque integer.

## The four binary operators

`apply` is the only place the four operators are defined ([`src/calc/op.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/op.rs#L29)). It takes the saved operand,
the current display, and the pending `Op`, and returns a `Result<Fixed, ErrorKind>`:

| Op | Computation | Error | Source |
|---|---|---|---|
| `None` | returns the display unchanged | none | `op.rs:31` |
| `Add` | `a.checked_add(b)` | `Overflow` | `op.rs:32` |
| `Sub` | `a.checked_sub(b)` | `Overflow` | `op.rs:33` |
| `Mul` | `a.checked_mul(b)` then `/ FRAC` to restore the scale | `Overflow` on the multiply | `op.rs:34` |
| `Div` | reject a zero divisor, else `a.checked_mul(FRAC) / b` | `DivByZero`, `Overflow` | `op.rs:38` |

Because there is one pending operator and no precedence, input is evaluated strictly left to right, exactly
like a four-function desk calculator. Multiply scales the product down after the checked multiply, and
divide scales the numerator up before the divide, which is what keeps `2.5 * 2` equal to `5` and not
`5e8` at the fixed-point scale (`op.rs:36`, `op.rs:42`).

## The unary functions

Three pure numeric transforms live in [`src/calc/unary.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/unary.rs), kept out of the action files so the math is in
one place:

| Function | Computation | Error | Source |
|---|---|---|---|
| `square(v)` | `v.checked_mul(v)` then `/ FRAC` | `Overflow` | `unary.rs:20` |
| `reciprocal(v)` | reject zero, else `(FRAC * FRAC) / v` | `DivByZero`, `Overflow` | `unary.rs:25` |
| `sqrt(v)` | reject negative, `sqrt(0) = 0`, else integer Newton root of `v * FRAC` | `DomainError`, `Overflow` | `unary.rs:33` |

`sqrt` scales the input up by `FRAC` before taking the integer root, which restores the fixed-point scale
in the result, and the root itself is a Newton-Raphson `integer_sqrt_u128` that converges from above with
no floating point anywhere (`unary.rs:40`, `unary.rs:44`). Reciprocal computes `FRAC^2 / v` so the result
is `1/v` at the correct scale, and it rejects zero before dividing (`unary.rs:26`).

## Operations

Every action is dispatched from `dispatch::run` ([`src/calc/actions/dispatch.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/dispatch.rs#L24)), one file per
operation under `src/calc/actions/`. Unless noted, each one guards its top with `if state.is_error()`
and does nothing while the display shows `Error`, so a stuck error can only be cleared by `AC`, `MC`, or
`MR`.

### Digit entry and the decimal point

| Operation | Behaviour | Source |
|---|---|---|
| Digit `0`..`9` | on a fresh number the digit replaces the display; otherwise it is appended, growing the integer part (capped at 16 integer digits) or the next fractional place (capped at 8) | [`src/calc/actions/digit.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/digit.rs#L24) |
| `.` (decimal) | switch entry into the fractional part; on a fresh number it starts from `0.` | [`src/calc/actions/decimal.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/decimal.rs#L19) |

Digit entry is where the fixed-point detail lives. It refuses a digit above `9` and does nothing on an
error (`digit.rs:25`). On the first digit of a fresh number the display is set to `digit * FRAC` and the
new-input latch is cleared (`digit.rs:28`). After that, an integer digit is folded in by pulling the value
apart into integer and fractional parts, shifting the integer part up one decimal place with
`saturating_mul(10)`, adding the digit, re-scaling by `FRAC`, and adding the fractional part back, refusing
once the integer part reaches 16 digits (`digit.rs:36`, `INTEGER_DIGIT_LIMIT` at `digit.rs:22`). A
fractional digit is placed at the next open fractional position by computing `digit * 10^(shift)` and
adding it, refusing once eight fractional digits are typed (`digit.rs:48`, `MAX_FRACTION_DIGITS` at
[`src/calc/fixed.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/fixed.rs#L20)). Every step uses `saturating_*` so a very long entry saturates instead of wrapping,
and the sign is preserved across the whole operation (`digit.rs:34`, `digit.rs:55`). The
`decimal_digits_typed` counter advances only once the fractional part is being built, so the first
fractional digit lands in the tenths place and each subsequent one moves right (`digit.rs:56`). The two
helpers `integer_digit_count` and `pow10` back this, both plain integer loops
([`src/calc/actions/digit_helpers.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/digit_helpers.rs#L19), `digit_helpers.rs:32`).

`decimal` is the switch into the fractional part. On a fresh number it zeros the display and clears
`new_input` so the number starts at `0.`, then sets `decimal_digits_typed` to `1` if it was still on the
integer part, which is what makes the next digit a tenths digit (`decimal.rs:23`, `decimal.rs:27`). Pressing
`.` a second time on the same number is a no-op because the counter is already past zero.

### Binary operators and evaluation

| Operation | Behaviour | Source |
|---|---|---|
| `+` `-` `*` `/` (set operator) | commit any pending operation first (chaining), then latch the new pending operator and begin a fresh operand | [`src/calc/actions/set_op.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/set_op.rs#L20) |
| `=` / Enter (equals) | apply the pending operator to the stored operand and the display, show the result, and clear the pending operator | [`src/calc/actions/equals.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/equals.rs#L20) |

Setting an operator is where chained arithmetic comes from. If an operator is already pending and the user
has entered a new operand (`operator != None && !new_input`), `set_op` evaluates the pending step
immediately and keeps the result as both the display and the new operand, so `2 + 3 + 4` shows `5` after
the second `+` and `9` after `=` (`set_op.rs:24`). If that intermediate evaluation errors, the operator is
dropped, the operand and display are zeroed, and the display latches the error (`set_op.rs:30`). Otherwise
it just saves the display into `operand` (`set_op.rs:40`). Either way it latches the new operator and
resets input for the next operand (`set_op.rs:42`).

Equals with no pending operator does nothing (`equals.rs:21`). Otherwise it applies the operator; on
success it shows the result, and on an error it latches the error and zeroes the display; either way it
clears the pending operator and operand and resets input (`equals.rs:24`).

### Unary functions

Each is applied to the current display value:

| Operation | Behaviour | Errors | Source |
|---|---|---|---|
| `+/-` (negate) | flip the sign of the display with `checked_neg` | `Overflow` on `i128::MIN` | [`src/calc/actions/negate.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/negate.rs#L20) |
| `%` (percent) | divide the display by 100 | none | [`src/calc/actions/percent.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/percent.rs#L20) |
| `x^2` (square) | multiply the display by itself | `Overflow` | [`src/calc/actions/square.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/square.rs#L20), [`src/calc/unary.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/unary.rs#L20) |
| `sqrt` (square root) | integer Newton square root of the display | `DomainError` on a negative input | [`src/calc/actions/square_root.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/square_root.rs#L20), [`src/calc/unary.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/unary.rs#L33) |
| `1/x` (reciprocal) | `FRAC^2 / display` | `DivByZero` on zero, `Overflow` | [`src/calc/actions/reciprocal.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/reciprocal.rs#L20), [`src/calc/unary.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/unary.rs#L25) |

Percent is a plain integer divide of the scaled value by 100 with no rounding, so `1 %` yields `0.01` and
`5 %` yields `0.05`, and it has no error path (`percent.rs:23`). Negate uses `checked_neg` and latches
`Overflow` only for `i128::MIN`, which no reachable entry can produce (`negate.rs:23`). Square, square
root, and reciprocal each call into `unary.rs`, latch the returned `ErrorKind` on failure, and reset input
so the result reads as a fresh number (`square.rs:24`, `square_root.rs:24`, `reciprocal.rs:24`).

### Memory register

The `M` row is an independent register that survives `AC`:

| Operation | Behaviour | Errors | Source |
|---|---|---|---|
| `MS` (memory store) | copy the display into memory | none | [`src/calc/actions/memory_store.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/memory_store.rs#L19) |
| `MR` (memory recall) | copy memory into the display, clear the error latch, start a new entry | none | [`src/calc/actions/memory_recall.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/memory_recall.rs#L19) |
| `M+` (memory add) | add the display to memory with `checked_add` | `Overflow`, register left unchanged | [`src/calc/actions/memory_add.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/memory_add.rs#L19) |
| `M-` (memory subtract) | subtract the display from memory with `checked_sub` | `Overflow`, register left unchanged | [`src/calc/actions/memory_sub.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/memory_sub.rs#L19) |
| `MC` (memory clear) | zero the memory register | none | [`src/calc/actions/memory_clear.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/memory_clear.rs#L19) |

`MR` and `MC` are the two operations that run even while the display shows `Error`. `MR` recalls memory,
resets the error latch to `None`, and starts a fresh input, so it doubles as a way out of a stuck error
(`memory_recall.rs:19`). `MC` runs unconditionally because it only zeroes the register
(`memory_clear.rs:19`). `MS`, `M+`, and `M-` all guard on `is_error` and do nothing while errored
(`memory_store.rs:20`, `memory_add.rs:20`, `memory_sub.rs:20`). `M+` and `M-` use the checked variants and
refuse to corrupt the register on overflow, latching an error and leaving the old register value in place
(`memory_add.rs:23`, `memory_sub.rs:23`). When the register is non-zero the [renderer](/docs/userland/calculator/rendering/) draws
a small amber `M` badge (`memory_engaged` at `state.rs:50`).

### Clear

| Operation | Behaviour | Source |
|---|---|---|
| `AC` / `c` / Backspace | zero the display and pending operand, drop the pending operator, and clear the error latch. Memory is not touched | [`src/calc/actions/clear.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/clear.rs#L20) |

`AC` is the universal reset for the arithmetic state, and it runs unconditionally, but it deliberately
leaves the memory register alone; only `MC` clears memory (`clear.rs:20` versus `memory_clear.rs:19`).

## Error handling

Errors are a single latch on `State`, one of `None`, `DivByZero`, `DomainError`, or `Overflow`
([`src/calc/state.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/state.rs#L20)). When any operation produces an error it sets the latch and zeroes the display
(for example `equals.rs:29`, `square.rs:26`). While the latch is set, the display paints the red text
`Error` instead of a number ([`src/calc/paint/display.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/paint/display.rs#L34), `ERROR_TEXT` at
[`src/calc/format/constants.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/format/constants.rs#L18)), and every operation except `AC`, `MC`, and `MR` returns early through
the `state.is_error()` guard (`state.rs:53`). The three ways to reach the error state:

- Divide by zero: `n / 0 =` sets `DivByZero`, and so does `1/x` on zero ([`src/calc/op.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/op.rs#L39),
  [`src/calc/unary.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/unary.rs#L26)).
- Domain error: `sqrt` of a negative display value sets `DomainError` ([`src/calc/unary.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/unary.rs#L34)).
- Overflow: any add, subtract, multiply, square, negate, or memory add/subtract that exceeds `i128`
  bounds sets `Overflow` through the `checked_*` path ([`src/calc/op.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/op.rs#L32), [`src/calc/unary.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/unary.rs#L21),
  [`src/calc/actions/negate.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/negate.rs#L26)).

## Formatting the display

The display value is turned into text in `src/calc/format/`. `format` splits the magnitude into integer
and fractional parts around `FRAC`, writes a leading `-` for a negative value, writes the integer part,
then writes a `.` and the fractional digits only when there are any ([`src/calc/format/display.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/format/display.rs#L23)). The
integer part is written by `write_u128`, a plain base-10 conversion into a scratch buffer read back in
order ([`src/calc/format/integer.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/format/integer.rs#L17)).

The fractional width is chosen by `effective_fraction_digits` ([`src/calc/format/fraction.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/format/fraction.rs#L19)): if the
user has pinned a width by typing fractional digits, that many are shown; otherwise trailing zeros are
trimmed so a computed value like `2.5` shows two-and-a-half, not `2.50000000`. `write_fraction` then emits
exactly that many digits by dividing down from the `FRAC` scale one place at a time (`fraction.rs:35`). The
whole result is bounded to `DISPLAY_MAX`, 32 bytes ([`src/calc/format/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/format/constants.rs#L17)), and the formatter
copies at most what fits into the caller's buffer, so a value with more precision than the panel can show
is rounded in display, never in the stored `i128` (`display.rs:43`).

## Source map

```
  src/calc/state.rs                  State and ErrorKind; is_error / memory_engaged / reset_input
  src/calc/fixed.rs                  Fixed = i128, FRAC = 1e8, MAX_FRACTION_DIGITS = 8
  src/calc/op.rs                     Op enum and apply(): the four binary operators
  src/calc/unary.rs                  square, reciprocal, integer sqrt
  src/calc/actions/dispatch.rs       Action -> operation module
  src/calc/actions/digit.rs          digit entry, integer and fractional folding
  src/calc/actions/digit_helpers.rs  integer_digit_count, pow10
  src/calc/actions/decimal.rs        switch into the fractional part
  src/calc/actions/set_op.rs         set/chain a binary operator
  src/calc/actions/equals.rs         evaluate the pending operator
  src/calc/actions/negate.rs         sign flip
  src/calc/actions/percent.rs        divide by 100
  src/calc/actions/square.rs         x squared
  src/calc/actions/square_root.rs    square root
  src/calc/actions/reciprocal.rs     1/x
  src/calc/actions/memory_*.rs       store, recall, add, subtract, clear
  src/calc/actions/clear.rs          all-clear
  src/calc/format/display.rs         value -> text
  src/calc/format/integer.rs         u128 -> decimal digits
  src/calc/format/fraction.rs        fractional width and digits
  src/calc/format/constants.rs       DISPLAY_MAX, ERROR_TEXT
```

Every reference above is verified against those trees.
