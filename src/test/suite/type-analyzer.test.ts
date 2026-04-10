import * as assert from 'assert';
import { TypeAnalyzer } from '../../type-analyzer';

suite('Type Analyzer Test Suite', () => {
	let typeAnalyzer: TypeAnalyzer;

	setup(() => {
		typeAnalyzer = new TypeAnalyzer();
	});

	test('Should identify monomorphic signatures', () => {
		assert.strictEqual(
			typeAnalyzer.isMonomorphic('Signed 8 -> Signed 8 -> Signed 8'),
			true,
			'Should recognize Signed 8 -> Signed 8 -> Signed 8 as monomorphic'
		);

		assert.strictEqual(
			typeAnalyzer.isMonomorphic('Unsigned 16 -> Unsigned 16 -> Unsigned 32'),
			true,
			'Should recognize Unsigned types as monomorphic'
		);

		assert.strictEqual(
			typeAnalyzer.isMonomorphic('Clock Dom50 -> Reset Dom50 -> Enable Dom50 -> Signal Dom50 (Unsigned 8) -> Signal Dom50 (Unsigned 8)'),
			true,
			'Should recognize concrete clock domain types as monomorphic'
		);
	});

	test('Should identify polymorphic signatures', () => {
		assert.strictEqual(
			typeAnalyzer.isMonomorphic('a -> a -> a'),
			false,
			'Should recognize type variable a as polymorphic'
		);

		assert.strictEqual(
			typeAnalyzer.isMonomorphic('Num a => a -> a -> a'),
			false,
			'Should recognize constrained type variables as polymorphic'
		);

		assert.strictEqual(
			typeAnalyzer.isMonomorphic('(HiddenClockResetEnable dom, KnownNat n) => Signal dom (Unsigned n) -> Signal dom (Unsigned n)'),
			false,
			'Should recognize dom and n type variables as polymorphic'
		);
	});

	test('Should handle edge cases', () => {
		assert.strictEqual(
			typeAnalyzer.isMonomorphic(''),
			false,
			'Should return false for empty string'
		);

		assert.strictEqual(
			typeAnalyzer.isMonomorphic('Int -> Int'),
			true,
			'Should recognize basic Haskell types as monomorphic'
		);
	});

	test('Should explain monomorphism correctly', () => {
		const monoExplanation = typeAnalyzer.explainMonomorphism('Signed 8 -> Signed 8');
		assert.ok(
			monoExplanation.includes('Monomorphic'),
			'Should explain monomorphic types correctly'
		);

		const polyExplanation = typeAnalyzer.explainMonomorphism('a -> a');
		assert.ok(
			polyExplanation.includes('Polymorphic'),
			'Should explain polymorphic types correctly'
		);
		assert.ok(
			polyExplanation.includes('a'),
			'Should list type variables'
		);
	});

	test('Should handle multiple type variables', () => {
		assert.strictEqual(
			typeAnalyzer.isMonomorphic('a -> b -> c'),
			false,
			'Should detect multiple type variables'
		);
	});

	test('Should handle complex nested types', () => {
		assert.strictEqual(
			typeAnalyzer.isMonomorphic('Vec 8 (Signed 16) -> Vec 8 (Signed 16)'),
			true,
			'Should recognize nested concrete types as monomorphic'
		);
	});

	test('Should distinguish type constructors from variables', () => {
		assert.strictEqual(
			typeAnalyzer.isMonomorphic('Signal Dom50 (Unsigned 8)'),
			true,
			'Signal with concrete domain should be monomorphic'
		);

		assert.strictEqual(
			typeAnalyzer.isMonomorphic('Signal dom (Unsigned 8)'),
			false,
			'Signal with type variable domain should be polymorphic'
		);
	});

	test('Should handle Bool and simple types', () => {
		assert.strictEqual(
			typeAnalyzer.isMonomorphic('Bool -> Bool'),
			true,
			'Bool -> Bool should be monomorphic'
		);

		assert.strictEqual(
			typeAnalyzer.isMonomorphic('BitVector 32 -> Index 256 -> Bool'),
			true,
			'BitVector and Index with concrete sizes should be monomorphic'
		);
	});

	test('Should handle constraint-only polymorphism', () => {
		// Even after removing constraints, the remaining type has variables
		assert.strictEqual(
			typeAnalyzer.isMonomorphic('KnownNat n => Vec n (Signed 8) -> Signed 8'),
			false,
			'KnownNat n constraint means n is a type variable'
		);
	});

	test('Should handle no-argument type (constant)', () => {
		assert.strictEqual(
			typeAnalyzer.isMonomorphic('Signed 8'),
			true,
			'A bare concrete type should be monomorphic'
		);
	});

	test('Should handle Maybe and Either', () => {
		assert.strictEqual(
			typeAnalyzer.isMonomorphic('Maybe (Signed 8) -> Signed 8'),
			true,
			'Maybe with concrete inner type should be monomorphic'
		);

		assert.strictEqual(
			typeAnalyzer.isMonomorphic('Maybe a -> a'),
			false,
			'Maybe with type variable should be polymorphic'
		);
	});
});
