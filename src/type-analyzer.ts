/**
 * Analyzes Haskell type signatures to determine if functions are monomorphic
 * and therefore synthesizable by Clash.
 */

export class TypeAnalyzer {
    
    /**
     * Determine if a type signature is monomorphic (fully concrete)
     * 
     * A function is monomorphic if:
     * - It has no free type variables (a, b, c, n, dom, etc.)
     * - All types are concrete (Signed 8, Unsigned 16, Clock Dom50, etc.)
     * 
     * Examples:
     * - Monomorphic: "Signed 8 -> Signed 8 -> Signed 8"
     * - Polymorphic: "Num a => a -> a -> a"
     * - Polymorphic: "Signal dom (Unsigned n) -> Signal dom (Unsigned n)"
     */
    isMonomorphic(typeSignature: string): boolean {
        if (!typeSignature) {
            return false;
        }

        // Remove constraints (everything before =>)
        const withoutConstraints = this.removeConstraints(typeSignature);
        
        // Check for type variables
        // Type variables are lowercase identifiers that:
        // 1. Appear as standalone tokens (not part of qualified names)
        // 2. Are not Haskell keywords or built-in types
        
        const hasTypeVariables = this.detectTypeVariables(withoutConstraints);
        
        return !hasTypeVariables;
    }

    /**
     * Remove type class constraints from a type signature
     * e.g., "(Num a, KnownNat n) => a -> a" becomes "a -> a"
     */
    private removeConstraints(typeSignature: string): string {
        const arrowIndex = typeSignature.indexOf('=>');
        if (arrowIndex !== -1) {
            return typeSignature.substring(arrowIndex + 2).trim();
        }
        return typeSignature;
    }

    /**
     * Detect if there are type variables in the type signature
     */
    private detectTypeVariables(typeSignature: string): boolean {
        // Tokenize the type signature
        const tokens = this.tokenizeType(typeSignature);
        
        // Known concrete type constructors that are uppercase
        const concreteTypes = new Set([
            'Signed', 'Unsigned', 'Signal', 'Clock', 'Reset', 'Enable',
            'BitVector', 'Index', 'Vec', 'Bool', 'Int', 'Integer',
            'Maybe', 'Either', 'IO', 'String', 'Char',
            'HiddenClockResetEnable', 'KnownNat', 'KnownDomain'
        ]);
        
        for (const token of tokens) {
            // Skip if it's a concrete type or operator
            if (concreteTypes.has(token)) {
                continue;
            }
            
            // Skip operators and punctuation
            if (this.isOperatorOrPunctuation(token)) {
                continue;
            }
            
            // Skip numeric literals (e.g., "8" in "Signed 8")
            if (/^\d+$/.test(token)) {
                continue;
            }
            
            // Skip qualified names with modules (e.g., "Dom50" in "Clock Dom50")
            if (/^[A-Z][a-zA-Z0-9]*$/.test(token)) {
                // This is a concrete type (starts with uppercase)
                continue;
            }
            
            // If we find a lowercase identifier, it's likely a type variable
            if (/^[a-z][a-zA-Z0-9_']*$/.test(token)) {
                return true; // Found a type variable
            }
        }
        
        return false; // No type variables found
    }

    /**
     * Tokenize a type signature into individual tokens
     */
    private tokenizeType(typeSignature: string): string[] {
        // Split on whitespace and common type signature delimiters
        // while preserving the delimiters we want to check
        const tokens: string[] = [];
        let current = '';
        
        for (let i = 0; i < typeSignature.length; i++) {
            const char = typeSignature[i];
            
            if (/\s/.test(char)) {
                if (current) {
                    tokens.push(current);
                    current = '';
                }
            } else if ('()[]{},->='.includes(char)) {
                if (current) {
                    tokens.push(current);
                    current = '';
                }
                tokens.push(char);
            } else {
                current += char;
            }
        }
        
        if (current) {
            tokens.push(current);
        }
        
        return tokens;
    }

    /**
     * Check if a token is an operator or punctuation
     */
    private isOperatorOrPunctuation(token: string): boolean {
        const operatorsAndPunctuation = [
            '->', '=>', '(', ')', '[', ']', '{', '}', ',', '~', '*'
        ];
        return operatorsAndPunctuation.includes(token);
    }

    /**
     * Get a human-readable explanation of why a function is/isn't monomorphic
     */
    explainMonomorphism(typeSignature: string): string {
        if (!typeSignature) {
            return "No type signature available";
        }

        if (this.isMonomorphic(typeSignature)) {
            return "✓ Monomorphic - can be synthesized to hardware";
        } else {
            const withoutConstraints = this.removeConstraints(typeSignature);
            const typeVars = this.findTypeVariables(withoutConstraints);
            
            if (typeVars.length > 0) {
                return `✗ Polymorphic - contains type variables: ${typeVars.join(', ')}`;
            } else {
                return "✗ Contains type constraints that prevent synthesis";
            }
        }
    }

    /**
     * Find all type variables in a type signature
     */
    private findTypeVariables(typeSignature: string): string[] {
        const tokens = this.tokenizeType(typeSignature);
        const typeVars: string[] = [];
        
        for (const token of tokens) {
            if (/^[a-z][a-zA-Z0-9_']*$/.test(token) && !this.isOperatorOrPunctuation(token)) {
                if (!typeVars.includes(token)) {
                    typeVars.push(token);
                }
            }
        }
        
        return typeVars;
    }
}
