# DigitalJS Troubleshooting

## Common Issues and Solutions

### Issue: "Invalid cell type: $specify2" (or $specify3)

**Problem**: When converting Yosys JSON to DigitalJS format, you get an error like:
```
ERROR: Conversion failed: Invalid cell type: $specify2
```

**Cause**: Yosys includes timing specification cells (`$specify2`, `$specify3`) in the netlist, but DigitalJS only supports logic simulation and cannot handle timing-related cells.

**Solution**: ✅ **FIXED in current version!** The extension now uses `yosys2digitaljs.process_files()` which:
- Runs Yosys internally with correct options
- Automatically removes timing specification cells
- Handles all cleanup and optimization
- Converts directly to DigitalJS format

**Previous approach** (caused the issue):
- We ran Yosys separately and generated JSON
- Then tried to convert that JSON with `yosys2digitaljs(json, {})`
- The Yosys JSON contained unsupported cell types

**Current approach** (works correctly):
- We pass Verilog source files to `yosys2digitaljs.process_files()`
- It runs its own Yosys synthesis internally
- All cleanup is handled automatically
- This is the same approach used by digitaljs_code and EDACation extensions

### Issue: DigitalJS shows empty or incomplete circuit

**Problem**: The circuit viewer loads but shows very few components or is mostly empty.

**Possible causes**:
1. **Over-optimization**: Yosys optimized away most of the logic
   - Solution: Check your Haskell function - it might be too simple (e.g., constant output)
   - Try a more complex function with actual logic gates

2. **Hierarchical design**: The design has sub-modules that aren't flattened
   - Solution: Add `flatten` to Yosys script before JSON generation
   - Note: This is not currently automatic but can be added if needed

3. **Unsupported cell types**: Some cells were removed but not replaced
   - Solution: Check `yosys.log` for warnings about removed cells
   - Use `techmap` to map complex cells to simpler primitives

### Issue: Circuit too complex, browser slow

**Problem**: DigitalJS viewer is slow or unresponsive with large circuits.

**Solutions**:
1. Use simpler test functions first
2. Break complex designs into smaller modules
3. Use the zoom controls to focus on specific areas
4. Check browser developer console for performance issues

### Issue: Cannot interact with inputs

**Problem**: Clicking on inputs doesn't change their values.

**Causes**:
1. **No inputs**: Circuit is purely combinational with no external inputs
   - Add input signals to your Haskell function
   
2. **Simulation not started**: Forgot to click "Start"
   - Click the ▶ Start button in the toolbar

3. **Clock-gated inputs**: Inputs require clock signal to change
   - Sequential circuits need clock toggling
   - Try toggling the clock input first

## Debugging Tips

### Check Yosys Log

Look at `.clash/Module.Function/03-yosys/yosys.log` for:
- Warnings about removed cells
- Optimization statistics
- Cell type information

### Inspect JSON Output

The JSON file at `.clash/Module.Function/03-yosys/TopModule.json` contains:
- `modules`: Circuit hierarchy
- `cells`: Individual circuit components
- `netnames`: Signal names and connections

You can open this file directly to see what DigitalJS will try to render.

### Test with Simple Design

Try these simple test cases first:

```haskell
-- Basic AND gate
andGate :: Bit -> Bit -> Bit
andGate a b = a .&. b

-- 4-bit adder
adder :: Unsigned 4 -> Unsigned 4 -> Unsigned 4
adder a b = a + b

-- Simple register
register :: Signal System Bit -> Signal System Bit
register = register 0
```

If these work, gradually increase complexity.

## Reporting Issues

If you encounter conversion errors not listed here:

1. Check the Output panel for full error messages
2. Look at `yosys.log` for synthesis details
3. Verify the JSON file was created
4. Test with a minimal example
5. Report with:
   - Error message
   - Haskell source code
   - Yosys log (relevant sections)
   - Extension version
