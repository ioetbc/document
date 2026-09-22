type Values = Record<string, string | number>;

// Match complete schema keys before generic identifiers, longest first.
function operandPattern(values: Values) {
  const keys = Object.keys(values).filter(Boolean).sort((a, b) => b.length - a.length)
    .map(key => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return `(?:${keys.length ? `(?:${keys.join("|")})(?![A-Za-z0-9_])|` : ""}[A-Za-z_]\\w*|\\d+(?:\\.\\d+)?|\\.\\d+)`;
}

/** A small arithmetic parser: schema values are never coerced or executed. */
export function calculate(expression: string, values: Values): number | "invalid calc" {
  const tokens = expression.match(new RegExp(`${operandPattern(values)}|[^\\s]`, "g")) ?? [];
  let position = 0;

  function primary(): number {
    const token = tokens[position++];
    if (token === "+") return primary();
    if (token === "-") return -primary();
    if (token === "(") {
      const value = sum();
      if (tokens[position++] !== ")") throw new Error("Missing closing parenthesis");
      return value;
    }
    if (token && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(token)) return Number(token);
    if (token && Object.hasOwn(values, token) && typeof values[token] === "number") return values[token];
    throw new Error("Expected a number");
  }

  function product(): number {
    let value = primary();
    while (tokens[position] === "*" || tokens[position] === "/") {
      const operator = tokens[position++];
      const right = primary();
      if (operator === "/" && right === 0) throw new Error("Division by zero");
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }

  function sum(): number {
    let value = product();
    while (tokens[position] === "+" || tokens[position] === "-") {
      const operator = tokens[position++];
      const right = product();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  try {
    const result = sum();
    return position === tokens.length && Number.isFinite(result) ? result : "invalid calc";
  } catch {
    return "invalid calc";
  }
}

/** A trailing equals sign explicitly finalizes a calculation. */
export function findCalculations(text: string, values: Values) {
  // Find the arithmetic suffix so a label such as "per square feet" is prose.
  const operand = operandPattern(values);
  const arithmeticSuffix = new RegExp(`(?:^|[ \t])([ \t()+-]*${operand}(?:[ \t()]*[+*/-][ \t()+-]*${operand})+[ \t()]*)$`);
  return Array.from(text.matchAll(/^([^\n=]+)=[ \t]*$/gm), match => {
    const suffix = arithmeticSuffix.exec(match[1]);
    const preceding = suffix ? match[1].slice(0, suffix.index).trimEnd() : "";
    // Do not hide a malformed arithmetic prefix by calculating only its tail.
    const expression = suffix && !/[+*/(\-]$/.test(preceding) ? suffix[1] : match[1];
    return {
      position: match.index + match[0].length,
      result: calculate(expression, values),
      prefix: " ",
    };
  });
}
