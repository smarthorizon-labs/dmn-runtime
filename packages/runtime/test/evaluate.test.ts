import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { feelNumberToString, isFeelNumber, toFeelNumber } from '@smarthorizon-labs/dmn-feel';
import type { FeelValue } from '@smarthorizon-labs/dmn-feel';
import { loadDmnXml } from '@smarthorizon-labs/dmn-xml';
import { describe, expect, it } from 'vitest';

import { compileModel, splitOutputValues } from '../src/compile.js';
import { evaluateDecisionService, evaluateModel } from '../src/evaluate.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sample = readFileSync(resolve(repoRoot, 'samples/loan-pre-qualification.dmn'), 'utf8');

function text(value: FeelValue): string {
  return isFeelNumber(value) ? feelNumberToString(value) : String(value);
}

/** Builds a one-decision model around a decision table, for hit-policy tests. */
function tableModel(attributes: string, body: string) {
  return loadDmnXml(
    `<definitions xmlns="https://www.omg.org/spec/DMN/20230324/MODEL/" namespace="urn:test" name="t">
       <inputData name="x"><variable name="x" typeRef="number"/></inputData>
       <decision name="d">
         <variable name="d"/>
         <informationRequirement><requiredInput href="#x"/></informationRequirement>
         <decisionTable ${attributes}>
           <input><inputExpression><text>x</text></inputExpression></input>
           ${body}
         </decisionTable>
       </decision>
     </definitions>`,
  );
}

function evaluate(model: ReturnType<typeof loadDmnXml>, x: string) {
  const compiled = compileModel(model);
  const result = evaluateModel(compiled, { x: toFeelNumber(x) });
  return result.decisions.get('d');
}

/** FEEL uses `<` and `>`; XML text needs them escaped. */
function xml(feel: string) {
  return feel.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

function rule(condition: string, ...outputs: string[]) {
  return `<rule><inputEntry><text>${xml(condition)}</text></inputEntry>${outputs
    .map((output) => `<outputEntry><text>${xml(output)}</text></outputEntry>`)
    .join('')}</rule>`;
}

describe('the committed DMN 1.2 sample', () => {
  const compiled = compileModel(loadDmnXml(sample));

  it('orders decisions after their dependencies', () => {
    const order = compiled.order.map((id) => compiled.decisions.get(id)?.name);
    expect(order.indexOf('Loan Pre-Qualification')).toBeGreaterThan(
      order.indexOf('Credit Score Rating'),
    );
  });

  it('evaluates a UNIQUE decision table over a nested input path', () => {
    const result = evaluateModel(compiled, {
      'Credit Score': { FICO: toFeelNumber('720') },
    });

    expect(result.decisions.get('Credit Score Rating')?.value).toBe('Good');
  });

  it('selects the boundary rule of a half-open interval', () => {
    // [700..750) — 750 belongs to the next rule up.
    const at750 = evaluateModel(compiled, { 'Credit Score': { FICO: toFeelNumber('750') } });
    expect(at750.decisions.get('Credit Score Rating')?.value).toBe('Excellent');
  });

  it('feeds a decision result into a dependent decision', () => {
    // Loan Pre-Qualification reads Credit Score Rating; the other two inputs
    // are unavailable, so the FIRST rule on "Poor", "Bad" is the one reachable.
    const result = evaluateModel(compiled, {
      'Credit Score': { FICO: toFeelNumber('550') },
    });

    const qualification = result.decisions.get('Loan Pre-Qualification')?.value as Record<
      string,
      FeelValue
    >;

    expect(qualification['Qualification']).toBe('Not Qualified');
    expect(qualification['Reason']).toBe('Credit Score too low.');
  });
});

describe('hit policies', () => {
  it('UNIQUE returns the single match', () => {
    const model = tableModel('hitPolicy="UNIQUE"', `<output/>${rule('< 10', '"low"')}`);
    expect(evaluate(model, '5')?.value).toBe('low');
  });

  it('UNIQUE fails when two rules match', () => {
    const model = tableModel(
      'hitPolicy="UNIQUE"',
      `<output/>${rule('< 10', '"a"')}${rule('< 20', '"b"')}`,
    );
    const result = evaluate(model, '5');
    expect(result?.failed).toBe(true);
    expect(result?.messages[0]).toMatch(/UNIQUE hit policy matched 2 rules/u);
  });

  it('FIRST returns the earliest match', () => {
    const model = tableModel(
      'hitPolicy="FIRST"',
      `<output/>${rule('< 10', '"a"')}${rule('< 20', '"b"')}`,
    );
    expect(evaluate(model, '5')?.value).toBe('a');
  });

  it('ANY accepts agreeing matches and fails on disagreement', () => {
    const agreeing = tableModel(
      'hitPolicy="ANY"',
      `<output/>${rule('< 10', '"same"')}${rule('< 20', '"same"')}`,
    );
    expect(evaluate(agreeing, '5')?.value).toBe('same');

    const conflicting = tableModel(
      'hitPolicy="ANY"',
      `<output/>${rule('< 10', '"a"')}${rule('< 20', '"b"')}`,
    );
    expect(evaluate(conflicting, '5')?.failed).toBe(true);
  });

  it('RULE ORDER collects matches in rule order', () => {
    const model = tableModel(
      'hitPolicy="RULE ORDER"',
      `<output/>${rule('< 10', '"a"')}${rule('< 20', '"b"')}`,
    );
    expect(evaluate(model, '5')?.value).toEqual(['a', 'b']);
  });

  it('COLLECT with SUM aggregates in decimal', () => {
    const model = tableModel(
      'hitPolicy="COLLECT" aggregation="SUM"',
      `<output/>${rule('< 10', '0.1')}${rule('< 20', '0.2')}`,
    );
    expect(text(evaluate(model, '5')?.value ?? null)).toBe('0.3');
  });

  it('COLLECT with COUNT counts matched rules', () => {
    const model = tableModel(
      'hitPolicy="COLLECT" aggregation="COUNT"',
      `<output/>${rule('< 10', '"a"')}${rule('< 20', '"b"')}`,
    );
    expect(text(evaluate(model, '5')?.value ?? null)).toBe('2');
  });

  it('PRIORITY orders matches by the output clause priority list', () => {
    const model = tableModel(
      'hitPolicy="PRIORITY"',
      `<output><outputValues><text>"high","low"</text></outputValues></output>` +
        `${rule('< 10', '"low"')}${rule('< 20', '"high"')}`,
    );
    // Rule order says "low" first, priority says "high" wins.
    expect(evaluate(model, '5')?.value).toBe('high');
  });

  it('OUTPUT ORDER returns all matches in priority order', () => {
    const model = tableModel(
      'hitPolicy="OUTPUT ORDER"',
      `<output><outputValues><text>"high","low"</text></outputValues></output>` +
        `${rule('< 10', '"low"')}${rule('< 20', '"high"')}`,
    );
    expect(evaluate(model, '5')?.value).toEqual(['high', 'low']);
  });
});

describe('no matching rule', () => {
  it('yields null for a single-hit policy', () => {
    const model = tableModel('hitPolicy="UNIQUE"', `<output/>${rule('< 10', '"low"')}`);
    expect(evaluate(model, '50')?.value).toBeNull();
  });

  it('yields the default output entry when one is declared', () => {
    const model = tableModel(
      'hitPolicy="UNIQUE"',
      `<output><defaultOutputEntry><text>"none"</text></defaultOutputEntry></output>` +
        rule('< 10', '"low"'),
    );
    expect(evaluate(model, '50')?.value).toBe('none');
  });

  it('yields an empty list for COLLECT', () => {
    const model = tableModel('hitPolicy="COLLECT"', `<output/>${rule('< 10', '"low"')}`);
    expect(evaluate(model, '50')?.value).toEqual([]);
  });
});

describe('result shape', () => {
  it('returns a context when the table has several outputs', () => {
    const model = tableModel(
      'hitPolicy="UNIQUE"',
      `<output name="a"/><output name="b"/>${rule('< 10', '"one"', '"two"')}`,
    );
    expect(evaluate(model, '5')?.value).toEqual({ a: 'one', b: 'two' });
  });
});

describe('business knowledge models', () => {
  // The committed DMN 1.2 sample invokes BKMs three ways: a boxed <invocation>
  // with named bindings, a FEEL call with no arguments, and one BKM reading
  // another through the surrounding context.
  const compiled = compileModel(loadDmnXml(sample));

  const applicant = {
    'Applicant Data': {
      Monthly: {
        Income: toFeelNumber('10000'),
        Repayments: toFeelNumber('1000'),
        Expenses: toFeelNumber('500'),
        Tax: toFeelNumber('200'),
        Insurance: toFeelNumber('100'),
      },
    },
  };

  it('invokes a parameterless BKM from a FEEL expression', () => {
    // `Lender Acceptable DTI()` is a literal 0.36.
    const result = evaluateModel(compiled, applicant);
    const backEnd = result.decisions.get('Back End Ratio');
    // (1000 + 500) / 10000 = 0.15, which is <= 0.36.
    expect(backEnd?.value).toBe('Sufficient');
  });

  it('reports the ratio as insufficient when the debt is too high', () => {
    const result = evaluateModel(compiled, {
      'Applicant Data': {
        Monthly: {
          Income: toFeelNumber('1000'),
          Repayments: toFeelNumber('400'),
          Expenses: toFeelNumber('200'),
          Tax: toFeelNumber('0'),
          Insurance: toFeelNumber('0'),
        },
      },
    });
    // (400 + 200) / 1000 = 0.6 > 0.36
    expect(result.decisions.get('Back End Ratio')?.value).toBe('Insufficient');
  });

  it('evaluates a boxed invocation with named bindings', () => {
    // Front End Ratio invokes PITI(pmt:, tax:, insurance:, income:).
    const result = evaluateModel(compiled, {
      ...applicant,
      'Requested Product': {
        Amount: toFeelNumber('100000'),
        Rate: toFeelNumber('5'),
        Term: toFeelNumber('360'),
      },
    });
    expect(result.decisions.get('Front End Ratio')?.value).toBe('Sufficient');
  });

  it('binds named arguments by parameter name, not by position', () => {
    const model = loadDmnXml(
      `<definitions xmlns="https://www.omg.org/spec/DMN/20230324/MODEL/" namespace="urn:t" name="t">
         <businessKnowledgeModel name="Divide" id="_div">
           <variable name="Divide"/>
           <encapsulatedLogic kind="FEEL">
             <formalParameter name="a" typeRef="number"/>
             <formalParameter name="b" typeRef="number"/>
             <literalExpression><text>a / b</text></literalExpression>
           </encapsulatedLogic>
         </businessKnowledgeModel>
         <decision name="d" id="_d">
           <variable name="d"/>
           <knowledgeRequirement><requiredKnowledge href="#_div"/></knowledgeRequirement>
           <literalExpression><text>Divide(b: 4, a: 10)</text></literalExpression>
         </decision>
       </definitions>`,
    );
    // Reversed order: a=10, b=4 gives 2.5, whereas positional would give 0.4.
    expect(text(evaluateModel(compileModel(model), {}).decisions.get('d')?.value ?? null)).toBe(
      '2.5',
    );
  });

  it('cuts off unbounded recursion with a diagnostic', () => {
    // Every BKM is bound in the shared context, so a BKM can invoke itself.
    // Without the depth limit this exhausts the JavaScript stack and surfaces
    // as a host crash rather than a diagnostic.
    const model = loadDmnXml(
      `<definitions xmlns="https://www.omg.org/spec/DMN/20230324/MODEL/" namespace="urn:t" name="t">
         <businessKnowledgeModel name="Forever" id="_f">
           <variable name="Forever"/>
           <encapsulatedLogic kind="FEEL">
             <formalParameter name="n" typeRef="number"/>
             <literalExpression><text>Forever(n + 1)</text></literalExpression>
           </encapsulatedLogic>
         </businessKnowledgeModel>
         <decision name="d" id="_d">
           <variable name="d"/>
           <knowledgeRequirement><requiredKnowledge href="#_f"/></knowledgeRequirement>
           <literalExpression><text>Forever(1)</text></literalExpression>
         </decision>
       </definitions>`,
    );

    const compiledModel = compileModel(model);
    let result: ReturnType<typeof evaluateModel> | undefined;

    expect(() => {
      result = evaluateModel(compiledModel, {});
    }).not.toThrow();

    expect(result?.decisions.get('d')?.value).toBeNull();
    expect(result?.decisions.get('d')?.warnings.map((w) => w.code)).toContain(
      'FEEL_RECURSION_LIMIT',
    );
  });

  it('refuses to execute a non-FEEL functionKind', () => {
    // A model must never name host code for the engine to run.
    const model = loadDmnXml(
      `<definitions xmlns="https://www.omg.org/spec/DMN/20230324/MODEL/" namespace="urn:t" name="t">
         <businessKnowledgeModel name="Evil" id="_evil">
           <variable name="Evil"/>
           <encapsulatedLogic kind="Java">
             <literalExpression><text>java.lang.Runtime.getRuntime()</text></literalExpression>
           </encapsulatedLogic>
         </businessKnowledgeModel>
         <decision name="d" id="_d">
           <variable name="d"/>
           <knowledgeRequirement><requiredKnowledge href="#_evil"/></knowledgeRequirement>
           <literalExpression><text>Evil()</text></literalExpression>
         </decision>
       </definitions>`,
    );
    const result = evaluateModel(compileModel(model), {});
    expect(result.decisions.get('d')?.value).toBeNull();
    expect(result.decisions.get('d')?.warnings.map((w) => w.code)).toContain(
      'FEEL_UNSUPPORTED_CONSTRUCT',
    );
  });
});

describe('singleton-list coercion', () => {
  // Confirmed against Drools 10.2.0 and TCK 0082-feel-coercion.
  function coercionModel(typeRef: string, expression: string, collection = false) {
    return loadDmnXml(
      `<definitions xmlns="https://www.omg.org/spec/DMN/20230324/MODEL/" namespace="urn:t" name="t">
         <itemDefinition name="tList" isCollection="${String(collection)}">
           <typeRef>number</typeRef>
         </itemDefinition>
         <decision name="d" id="_d">
           <variable name="d" typeRef="${typeRef}"/>
           <literalExpression><text>${expression}</text></literalExpression>
         </decision>
       </definitions>`,
    );
  }

  function valueOf(model: ReturnType<typeof loadDmnXml>) {
    return evaluateModel(compileModel(model), {}).decisions.get('d')?.value ?? null;
  }

  it('unwraps a one-element list assigned to a scalar type', () => {
    expect(valueOf(coercionModel('string', '["foo"]'))).toBe('foo');
    expect(text(valueOf(coercionModel('number', '[10]')))).toBe('10');
  });

  it('wraps a conforming scalar assigned to a collection type', () => {
    expect(valueOf(coercionModel('tList', '7', true))).toHaveLength(1);
  });

  it('yields null rather than wrapping a non-conforming scalar', () => {
    // TCK 0082 `decision_006_a`: a string assigned to a list-of-number is
    // null, not `["foo"]`. Drools 10.2.0 returns `["foo"]` here; this follows
    // the TCK against the reference engine.
    expect(valueOf(coercionModel('tList', '"foo"', true))).toBeNull();
  });

  it('yields null rather than unwrapping a non-conforming element', () => {
    // TCK 0082 `literal_006`.
    expect(valueOf(coercionModel('number', '["foo"]'))).toBeNull();
  });

  it('checks the elements of a list against the declared element type', () => {
    expect(valueOf(coercionModel('tList', '["foo"]', true))).toBeNull();
    expect(valueOf(coercionModel('tList', '[1, 2]', true))).toHaveLength(2);
  });

  it('leaves a multi-element list alone', () => {
    expect(valueOf(coercionModel('string', '["a", "b"]'))).toEqual(['a', 'b']);
  });

  it('leaves a list assigned to a collection type alone', () => {
    expect(valueOf(coercionModel('tList', '[1, 2]', true))).toHaveLength(2);
  });

  it('does not coerce null in either direction', () => {
    expect(valueOf(coercionModel('tList', 'null', true))).toBeNull();
    expect(valueOf(coercionModel('string', 'null'))).toBeNull();
  });

  it('does not coerce when no type is declared', () => {
    const model = loadDmnXml(
      `<definitions xmlns="https://www.omg.org/spec/DMN/20230324/MODEL/" namespace="urn:t" name="t">
         <decision name="d" id="_d">
           <variable name="d"/>
           <literalExpression><text>["foo"]</text></literalExpression>
         </decision>
       </definitions>`,
    );
    expect(valueOf(model)).toEqual(['foo']);
  });
});

describe('decision services', () => {
  // Modelled on DMN TCK 0085-decision-services, whose expectations were
  // confirmed against Drools 10.2.0.
  const model = loadDmnXml(
    `<definitions xmlns="https://www.omg.org/spec/DMN/20230324/MODEL/" namespace="urn:test" name="svc">
       <decisionService name="svc_002" id="_svc_002">
         <variable name="svc_002"/>
         <outputDecision href="#_out"/>
         <inputDecision href="#_param"/>
       </decisionService>

       <decision name="param" id="_param">
         <variable name="param"/>
         <literalExpression><text>"bar"</text></literalExpression>
       </decision>

       <decision name="out" id="_out">
         <variable name="out"/>
         <informationRequirement><requiredDecision href="#_param"/></informationRequirement>
         <literalExpression><text>"foo " + param</text></literalExpression>
       </decision>

       <decision name="unrelated" id="_unrelated">
         <variable name="unrelated"/>
         <literalExpression><text>"should not run"</text></literalExpression>
       </decision>
     </definitions>`,
  );

  const compiled = compileModel(model);

  it('takes an input decision from the caller instead of evaluating it', () => {
    // The whole point of the encapsulation: `param` has decision logic that
    // would produce "bar", and the service must not run it.
    const result = evaluateDecisionService(compiled, 'svc_002', { param: 'baz' });
    expect(result.decisions.get('out')?.value).toBe('foo baz');
    expect(result.decisions.has('param')).toBe(false);
  });

  it('treats an omitted input decision as null, never as its own logic', () => {
    // TCK 0085 case 002_b: supplying null makes `"foo " + null` fail, and the
    // service returns null rather than quietly substituting "bar".
    const result = evaluateDecisionService(compiled, 'svc_002', { param: null });
    expect(result.decisions.get('out')?.value).toBeNull();
    expect(result.value).toBeNull();
  });

  it('evaluates only what the outputs need', () => {
    const result = evaluateDecisionService(compiled, 'svc_002', { param: 'baz' });
    expect(result.decisions.has('unrelated')).toBe(false);
  });

  it('ignores and reports inputs the service does not declare', () => {
    const result = evaluateDecisionService(compiled, 'svc_002', {
      param: 'baz',
      smuggled: 'nope',
    });
    expect(result.warnings?.[0]).toMatch(/"smuggled" is not declared/u);
  });

  it('returns the single output decision as the service value', () => {
    expect(evaluateDecisionService(compiled, 'svc_002', { param: 'baz' }).value).toBe('foo baz');
  });

  it('reports an unknown service rather than evaluating something else', () => {
    const result = evaluateDecisionService(compiled, 'no_such_service', {});
    expect(result.failed).toBe(true);
    expect(result.decisions.size).toBe(0);
  });

  it('differs from evaluating the model with the same context', () => {
    // The distinction encapsulation requires. Whole-model evaluation runs
    // `param`'s own logic and produces "foo bar"; the service treats `param`
    // as a parameter and honours what the caller passed. If these two agreed,
    // the encapsulation would not be implemented.
    const viaModel = evaluateModel(compiled, { param: 'baz' });
    const viaService = evaluateDecisionService(compiled, 'svc_002', { param: 'baz' });

    expect(viaModel.decisions.get('out')?.value).toBe('foo bar');
    expect(viaService.decisions.get('out')?.value).toBe('foo baz');
  });
});

describe('output value parsing', () => {
  it('splits on commas outside quotes and brackets', () => {
    expect(splitOutputValues('"a","b"')).toEqual(['"a"', '"b"']);
    expect(splitOutputValues('"a,b","c"')).toEqual(['"a,b"', '"c"']);
    expect(splitOutputValues('[1..2],[3..4]')).toEqual(['[1..2]', '[3..4]']);
  });
});
