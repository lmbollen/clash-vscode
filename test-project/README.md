# Simple Clash Test Project

This is a test project for the Clash VS Code Yosys extension.

## Building

From within the Nix development shell:

```bash
cd test-project
cabal build
```

## Running Tests

```bash
cabal test
```

## Synthesizing to Verilog

Synthesize the default `topEntity`:

```bash
cabal run clash -- Example.Project --verilog
```

The generated Verilog will be in the `verilog/` directory.

## Example Functions

This project contains several functions to demonstrate the extension:

### Monomorphic Functions (Can be synthesized)

1. **plusSigned**: Adds two 8-bit signed numbers
   ```haskell
   plusSigned :: Signed 8 -> Signed 8 -> Signed 8
   ```

2. **multUnsigned**: Multiplies two 16-bit unsigned numbers, returns 32-bit result
   ```haskell
   multUnsigned :: Unsigned 16 -> Unsigned 16 -> Unsigned 32
   ```

3. **topEntity**: The main entity with clock, reset, and enable signals
   ```haskell
   topEntity :: Clock Dom50 -> Reset Dom50 -> Enable Dom50 
             -> Signal Dom50 (Unsigned 8) -> Signal Dom50 (Unsigned 8)
   ```

### Polymorphic Functions (Cannot be directly synthesized)

1. **plusPoly**: Polymorphic addition - requires type instantiation
   ```haskell
   plusPoly :: (Num a) => a -> a -> a
   ```

2. **accum**: Polymorphic accumulator (used internally by topEntity)
   ```haskell
   accum :: (HiddenClockResetEnable dom, KnownNat n) 
         => Signal dom (Unsigned n) -> Signal dom (Unsigned n)
   ```

## Using with the VS Code Extension

Once the extension is developed, you should be able to:

1. Open this project in VS Code
2. Run "Detect Functions" command
3. See `plusSigned` and `multUnsigned` marked as synthesizable
4. See `plusPoly` and `accum` marked as polymorphic
5. Select a monomorphic function to synthesize it automatically
