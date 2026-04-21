package handlers

import (
	"fmt"
	"math"
	"strings"
	"unicode"
)

// FormulaEvaluator evaluates math expressions with named variables.
// Supports: +, -, *, /, parentheses, numbers, variables, min(), max()
type FormulaEvaluator struct {
	vars map[string]float64
	expr string
	pos  int
}

func EvaluateFormula(expression string, vars map[string]float64) (float64, error) {
	e := &FormulaEvaluator{
		vars: vars,
		expr: strings.TrimSpace(expression),
		pos:  0,
	}
	result, err := e.parseExpression()
	if err != nil {
		return 0, err
	}
	if e.pos < len(e.expr) {
		return 0, fmt.Errorf("unexpected character at position %d: '%c'", e.pos, e.expr[e.pos])
	}
	return result, nil
}

func (e *FormulaEvaluator) skipSpaces() {
	for e.pos < len(e.expr) && e.expr[e.pos] == ' ' {
		e.pos++
	}
}

func (e *FormulaEvaluator) parseExpression() (float64, error) {
	return e.parseAddSub()
}

func (e *FormulaEvaluator) parseAddSub() (float64, error) {
	left, err := e.parseMulDiv()
	if err != nil {
		return 0, err
	}
	for {
		e.skipSpaces()
		if e.pos >= len(e.expr) {
			break
		}
		op := e.expr[e.pos]
		if op != '+' && op != '-' {
			break
		}
		e.pos++
		right, err := e.parseMulDiv()
		if err != nil {
			return 0, err
		}
		if op == '+' {
			left += right
		} else {
			left -= right
		}
	}
	return left, nil
}

func (e *FormulaEvaluator) parseMulDiv() (float64, error) {
	left, err := e.parseUnary()
	if err != nil {
		return 0, err
	}
	for {
		e.skipSpaces()
		if e.pos >= len(e.expr) {
			break
		}
		op := e.expr[e.pos]
		if op != '*' && op != '/' {
			break
		}
		e.pos++
		right, err := e.parseUnary()
		if err != nil {
			return 0, err
		}
		if op == '*' {
			left *= right
		} else {
			if right == 0 {
				return 0, fmt.Errorf("division by zero")
			}
			left /= right
		}
	}
	return left, nil
}

func (e *FormulaEvaluator) parseUnary() (float64, error) {
	e.skipSpaces()
	if e.pos < len(e.expr) && e.expr[e.pos] == '-' {
		e.pos++
		val, err := e.parsePrimary()
		if err != nil {
			return 0, err
		}
		return -val, nil
	}
	if e.pos < len(e.expr) && e.expr[e.pos] == '+' {
		e.pos++
	}
	return e.parsePrimary()
}

func (e *FormulaEvaluator) parsePrimary() (float64, error) {
	e.skipSpaces()
	if e.pos >= len(e.expr) {
		return 0, fmt.Errorf("unexpected end of expression")
	}

	// Parentheses
	if e.expr[e.pos] == '(' {
		e.pos++ // skip '('
		val, err := e.parseExpression()
		if err != nil {
			return 0, err
		}
		e.skipSpaces()
		if e.pos >= len(e.expr) || e.expr[e.pos] != ')' {
			return 0, fmt.Errorf("missing closing parenthesis")
		}
		e.pos++ // skip ')'
		return val, nil
	}

	// Number
	if e.expr[e.pos] >= '0' && e.expr[e.pos] <= '9' || e.expr[e.pos] == '.' {
		return e.parseNumber()
	}

	// Identifier (variable or function)
	if unicode.IsLetter(rune(e.expr[e.pos])) || e.expr[e.pos] == '_' {
		name := e.parseIdentifier()
		e.skipSpaces()

		// Check for function call
		if e.pos < len(e.expr) && e.expr[e.pos] == '(' {
			return e.parseFunction(name)
		}

		// Variable lookup
		if val, ok := e.vars[name]; ok {
			return val, nil
		}
		return 0, fmt.Errorf("unknown variable: %s", name)
	}

	return 0, fmt.Errorf("unexpected character: '%c'", e.expr[e.pos])
}

func (e *FormulaEvaluator) parseNumber() (float64, error) {
	start := e.pos
	for e.pos < len(e.expr) && (e.expr[e.pos] >= '0' && e.expr[e.pos] <= '9' || e.expr[e.pos] == '.') {
		e.pos++
	}
	var val float64
	_, err := fmt.Sscanf(e.expr[start:e.pos], "%f", &val)
	if err != nil {
		return 0, fmt.Errorf("invalid number: %s", e.expr[start:e.pos])
	}
	return val, nil
}

func (e *FormulaEvaluator) parseIdentifier() string {
	start := e.pos
	for e.pos < len(e.expr) && (unicode.IsLetter(rune(e.expr[e.pos])) || unicode.IsDigit(rune(e.expr[e.pos])) || e.expr[e.pos] == '_') {
		e.pos++
	}
	return strings.ToLower(e.expr[start:e.pos])
}

func (e *FormulaEvaluator) parseFunction(name string) (float64, error) {
	e.pos++ // skip '('
	var args []float64
	e.skipSpaces()

	if e.pos < len(e.expr) && e.expr[e.pos] != ')' {
		for {
			val, err := e.parseExpression()
			if err != nil {
				return 0, err
			}
			args = append(args, val)
			e.skipSpaces()
			if e.pos >= len(e.expr) || e.expr[e.pos] != ',' {
				break
			}
			e.pos++ // skip ','
		}
	}

	e.skipSpaces()
	if e.pos >= len(e.expr) || e.expr[e.pos] != ')' {
		return 0, fmt.Errorf("missing closing parenthesis for function %s", name)
	}
	e.pos++ // skip ')'

	switch name {
	case "min":
		if len(args) < 2 {
			return 0, fmt.Errorf("min() requires at least 2 arguments")
		}
		result := args[0]
		for _, a := range args[1:] {
			if a < result {
				result = a
			}
		}
		return result, nil
	case "max":
		if len(args) < 2 {
			return 0, fmt.Errorf("max() requires at least 2 arguments")
		}
		result := args[0]
		for _, a := range args[1:] {
			if a > result {
				result = a
			}
		}
		return result, nil
	case "abs":
		if len(args) != 1 {
			return 0, fmt.Errorf("abs() requires exactly 1 argument")
		}
		return math.Abs(args[0]), nil
	case "round":
		if len(args) != 1 {
			return 0, fmt.Errorf("round() requires exactly 1 argument")
		}
		return math.Round(args[0]*100) / 100, nil
	case "floor":
		if len(args) != 1 {
			return 0, fmt.Errorf("floor() requires exactly 1 argument")
		}
		return math.Floor(args[0]), nil
	case "ceil":
		if len(args) != 1 {
			return 0, fmt.Errorf("ceil() requires exactly 1 argument")
		}
		return math.Ceil(args[0]), nil
	default:
		return 0, fmt.Errorf("unknown function: %s", name)
	}
}
