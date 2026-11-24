import { tokenize, type Token } from './lexer';

export type ASTNode =
  | { kind: 'Literal'; value: number | string | boolean }
  | { kind: 'Ident'; name: string }
  | { kind: 'Unary'; op: string; arg: ASTNode }
  | { kind: 'Binary'; op: string; left: ASTNode; right: ASTNode }
  | { kind: 'Ternary'; cond: ASTNode; thenBranch: ASTNode; elseBranch: ASTNode }
  | { kind: 'Call'; callee: string; args: ASTNode[] };

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: 'EOF', value: '', pos: 0 };
  }

  private consume(): Token {
    const tok = this.peek();
    this.pos++;
    return tok;
  }

  private matchOp(...ops: string[]): string | null {
    const tok = this.peek();
    if (tok.type === 'OP' && ops.includes(tok.value)) {
      this.pos++;
      return tok.value;
    }
    return null;
  }

  parse(): ASTNode {
    const node = this.parseTernary();
    if (this.peek().type !== 'EOF') {
      throw new Error(`多余的语法符号 "${this.peek().value}"`);
    }
    return node;
  }

  private parseTernary(): ASTNode {
    const cond = this.parseOr();
    if (this.matchOp('?')) {
      const thenBranch = this.parseTernary();
      if (!this.matchOp(':')) {
        throw new Error('三元表达式缺少 ":"');
      }
      const elseBranch = this.parseTernary();
      return { kind: 'Ternary', cond, thenBranch, elseBranch };
    }
    return cond;
  }

  private parseOr(): ASTNode {
    let left = this.parseAnd();
    while (this.matchOp('||')) {
      const right = this.parseAnd();
      left = { kind: 'Binary', op: '||', left, right };
    }
    return left;
  }

  private parseAnd(): ASTNode {
    let left = this.parseEquality();
    while (this.matchOp('&&')) {
      const right = this.parseEquality();
      left = { kind: 'Binary', op: '&&', left, right };
    }
    return left;
  }

  private parseEquality(): ASTNode {
    let left = this.parseComparison();
    let op: string | null;
    while ((op = this.matchOp('==', '!='))) {
      const right = this.parseComparison();
      left = { kind: 'Binary', op, left, right };
    }
    return left;
  }

  private parseComparison(): ASTNode {
    let left = this.parseAdditive();
    let op: string | null;
    while ((op = this.matchOp('<', '<=', '>', '>='))) {
      const right = this.parseAdditive();
      left = { kind: 'Binary', op, left, right };
    }
    return left;
  }

  private parseAdditive(): ASTNode {
    let left = this.parseMultiplicative();
    let op: string | null;
    while ((op = this.matchOp('+', '-'))) {
      const right = this.parseMultiplicative();
      left = { kind: 'Binary', op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): ASTNode {
    let left = this.parseUnary();
    let op: string | null;
    while ((op = this.matchOp('*', '/', '%'))) {
      const right = this.parseUnary();
      left = { kind: 'Binary', op, left, right };
    }
    return left;
  }

  private parseUnary(): ASTNode {
    const op = this.matchOp('!', '-', '+');
    if (op) {
      return { kind: 'Unary', op, arg: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ASTNode {
    const tok = this.peek();

    if (tok.type === 'NUMBER') {
      this.consume();
      return { kind: 'Literal', value: Number(tok.value) };
    }
    if (tok.type === 'STRING') {
      this.consume();
      return { kind: 'Literal', value: tok.value };
    }
    if (tok.type === 'BOOLEAN') {
      this.consume();
      return { kind: 'Literal', value: tok.value === 'true' };
    }
    if (tok.type === 'LPAREN') {
      this.consume();
      const inner = this.parseTernary();
      if (this.peek().type !== 'RPAREN') {
        throw new Error('缺少右括号 ")"');
      }
      this.consume();
      return inner;
    }
    if (tok.type === 'IDENT') {
      this.consume();
      if (this.peek().type === 'LPAREN') {
        this.consume();
        const args: ASTNode[] = [];
        if (this.peek().type !== 'RPAREN') {
          args.push(this.parseTernary());
          while (this.peek().type === 'COMMA') {
            this.consume();
            args.push(this.parseTernary());
          }
        }
        if (this.peek().type !== 'RPAREN') {
          throw new Error(`函数 ${tok.value} 缺少右括号 ")"`);
        }
        this.consume();
        return { kind: 'Call', callee: tok.value, args };
      }
      return { kind: 'Ident', name: tok.value };
    }

    throw new Error(`意外的表达式符号 "${tok.value || 'EOF'}"`);
  }
}

export function parseFormula(expression: string): ASTNode {
  const trimmed = expression.trim();
  if (!trimmed) {
    throw new Error('公式为空');
  }
  const tokens = tokenize(trimmed);
  return new Parser(tokens).parse();
}

export function validateFormula(expression: string): string | null {
  try {
    parseFormula(expression);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : '公式语法错误';
  }
}
