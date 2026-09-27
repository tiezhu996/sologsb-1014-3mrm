import { redraw } from 'mithril';
import type { ProofCheck, ProofDocument, ProofStep, ProofVersion, StepStatus } from './types';

const STORAGE_KEY = 'sologsb-1014-proof-workspace-v1';
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const clone = <T>(value: T): T => structuredClone(value);

export const RULES = ['前提', '定义展开', '代入', '等式变形', '分配律', '同类项合并', '数学归纳', '反证法', '构造法', '结论'];

function sampleSteps(): ProofStep[] {
  return [
    { id: 's1', type: 'premise', statement: '$a,b$ 是实数', rule: '前提', references: [], note: '采用实数域中的交换律与分配律。', counterexample: '', alternative: '', alternativeEnabled: false },
    { id: 's2', type: 'derivation', statement: '$(a+b)^2=(a+b)(a+b)$', rule: '定义展开', references: ['s1'], note: '把平方写成两个相同因式之积。', counterexample: '', alternative: '', alternativeEnabled: false },
    { id: 's3', type: 'derivation', statement: '$(a+b)(a+b)=a^2+ab+ba+b^2$', rule: '分配律', references: ['s2'], note: '', counterexample: '', alternative: '也可先展开后半部分。', alternativeEnabled: false },
    { id: 's4', type: 'derivation', statement: '$a^2+ab+ba+b^2=a^2+2ab+b^2$', rule: '同类项合并', references: ['s3'], note: '由实数的交换律，$ab=ba$。', counterexample: '', alternative: '', alternativeEnabled: false },
    { id: 's5', type: 'goal', statement: '$(a+b)^2=a^2+2ab+b^2$', rule: '结论', references: ['s4'], note: '目标已由步骤 1 至 4 逐项推出。', counterexample: '', alternative: '', alternativeEnabled: false },
  ];
}

function issueSteps(): ProofStep[] {
  return [
    { id: 'i1', type: 'premise', statement: '$n$ 是正整数', rule: '前提', references: [], note: '', counterexample: '', alternative: '', alternativeEnabled: false },
    { id: 'i2', type: 'derivation', statement: '$P(1)$ 成立', rule: '前提', references: ['i1'], note: '归纳基例。', counterexample: '基例只验证了特殊取值，$P(1)$ 的一般表述不成立。', alternative: '改用强归纳：同时验证 $P(1)$ 与 $P(2)$ 作为基例。', alternativeEnabled: false },
    { id: 'i3', type: 'derivation', statement: '若 $P(k)$ 成立，则 $P(k+1)$ 也成立', rule: '数学归纳', references: ['i2', 'missing-step'], note: '这里故意保留一个失效引用，用于演示检查。', counterexample: '', alternative: '', alternativeEnabled: false },
    { id: 'i4', type: 'goal', statement: '$P(n)$ 对所有正整数 $n$ 成立', rule: '结论', references: ['i3'], note: '尚未补齐归纳假设。', counterexample: '', alternative: '', alternativeEnabled: false },
  ];
}

function initialDocuments(): ProofDocument[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'doc-algebra',
      title: '完全平方公式证明',
      author: '数学组',
      goal: '$(a+b)^2=a^2+2ab+b^2$',
      symbols: { a: '实数', b: '实数', P: '关于正整数的命题', n: '正整数', k: '正整数' },
      steps: sampleSteps(),
      versions: [],
      updatedAt: now,
    },
    {
      id: 'doc-induction',
      title: '数学归纳法待核对稿',
      author: '学生工作区',
      goal: '$P(n)$ 对所有正整数 $n$ 成立',
      symbols: { P: '关于正整数的命题', n: '正整数', k: '正整数' },
      steps: issueSteps(),
      versions: [],
      updatedAt: now,
    },
  ];
}

function normalizeStep(step: ProofStep): ProofStep {
  const alternative = step.alternative ?? '';
  return {
    ...step,
    note: step.note ?? '',
    counterexample: step.counterexample ?? '',
    alternative,
    // 旧稿子没有“启用替代分支”开关，读回时按未启用处理
    alternativeEnabled: step.alternativeEnabled === true && alternative.trim().length > 0,
  };
}

function loadDocuments(): ProofDocument[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialDocuments();
    const parsed = JSON.parse(raw) as ProofDocument[];
    if (!Array.isArray(parsed) || !parsed.length) return initialDocuments();
    return parsed.map((document) => ({
      ...document,
      steps: (document.steps ?? []).map(normalizeStep),
      versions: (document.versions ?? []).map((version) => ({ ...version, steps: (version.steps ?? []).map(normalizeStep) })),
    }));
  } catch {
    return initialDocuments();
  }
}

export class ProofStore {
  documents = loadDocuments();
  activeId = this.documents[0]?.id ?? '';
  selectedStepId = this.documents[0]?.steps[0]?.id ?? '';
  compareVersionId = '';
  dragStepId = '';
  lastInput: HTMLTextAreaElement | HTMLInputElement | null = null;
  undoStack: ProofDocument[][] = [];
  redoStack: ProofDocument[][] = [];
  toast = '';

  get current(): ProofDocument {
    return this.documents.find((item) => item.id === this.activeId) ?? this.documents[0];
  }

  get selectedStep(): ProofStep | undefined {
    return this.current?.steps.find((step) => step.id === this.selectedStepId);
  }

  get checks(): ProofCheck[] {
    if (!this.current) return [];
    return validate(this.current);
  }

  save(): void {
    this.current.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.documents));
  }

  update(mutator: (document: ProofDocument) => void): void {
    this.undoStack.push(clone(this.documents));
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
    mutator(this.current);
    this.save();
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(clone(this.documents));
    this.documents = previous;
    this.ensureSelection();
    this.save();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.documents));
    this.documents = next;
    this.ensureSelection();
    this.save();
  }

  selectDocument(id: string): void {
    this.activeId = id;
    this.compareVersionId = '';
    this.selectedStepId = this.current?.steps[0]?.id ?? '';
  }

  selectStep(id: string): void {
    this.selectedStepId = id;
  }

  ensureSelection(): void {
    if (!this.documents.some((item) => item.id === this.activeId)) this.activeId = this.documents[0]?.id ?? '';
    if (!this.current?.steps.some((step) => step.id === this.selectedStepId)) {
      this.selectedStepId = this.current?.steps[0]?.id ?? '';
    }
  }

  addDocument(): void {
    const id = uid('doc');
    const document: ProofDocument = {
      id,
      title: '未命名证明',
      author: '本地用户',
      goal: '$A=B$',
      symbols: { A: '待定义对象', B: '待定义对象' },
      steps: [{ id: uid('step'), type: 'premise', statement: '在这里输入前提', rule: '前提', references: [], note: '', counterexample: '', alternative: '', alternativeEnabled: false }],
      versions: [],
      updatedAt: new Date().toISOString(),
    };
    this.undoStack.push(clone(this.documents));
    this.documents.unshift(document);
    this.activeId = id;
    this.selectedStepId = document.steps[0].id;
    this.save();
  }

  removeDocument(id: string): void {
    if (this.documents.length <= 1) {
      this.notify('至少保留一个证明文档');
      return;
    }
    this.undoStack.push(clone(this.documents));
    this.documents = this.documents.filter((item) => item.id !== id);
    this.ensureSelection();
    this.save();
  }

  addStep(type: ProofStep['type'] = 'derivation'): void {
    const step: ProofStep = {
      id: uid('step'),
      type,
      statement: type === 'goal' ? '$A=B$' : '输入新的推导式',
      rule: type === 'goal' ? '结论' : '等式变形',
      references: this.selectedStepId ? [this.selectedStepId] : [],
      note: '',
      counterexample: '',
      alternative: '',
      alternativeEnabled: false,
    };
    this.update((document) => {
      const selectedIndex = document.steps.findIndex((item) => item.id === this.selectedStepId);
      document.steps.splice(type === 'goal' ? document.steps.length : selectedIndex + 1, 0, step);
    });
    this.selectedStepId = step.id;
  }

  removeStep(id: string): void {
    this.update((document) => {
      document.steps = document.steps.filter((step) => step.id !== id);
      document.steps.forEach((step) => {
        step.references = step.references.filter((reference) => reference !== id);
      });
    });
    this.ensureSelection();
  }

  moveStep(sourceId: string, targetId: string): void {
    if (sourceId === targetId) return;
    this.update((document) => {
      const from = document.steps.findIndex((step) => step.id === sourceId);
      const to = document.steps.findIndex((step) => step.id === targetId);
      if (from < 0 || to < 0) return;
      const [moved] = document.steps.splice(from, 1);
      document.steps.splice(to, 0, moved);
    });
  }

  updateStep(patch: Partial<ProofStep>): void {
    const id = this.selectedStepId;
    this.update((document) => {
      const step = document.steps.find((item) => item.id === id);
      if (!step) return;
      Object.assign(step, patch);
      // 替代分支内容为空时强制回到未启用状态
      if (!step.alternative.trim()) step.alternativeEnabled = false;
    });
  }

  createVersion(): void {
    this.update((document) => {
      const version: ProofVersion = {
        id: uid('version'),
        name: `版本 ${document.versions.length + 1}`,
        createdAt: new Date().toISOString(),
        steps: clone(document.steps),
        goal: document.goal,
      };
      document.versions.unshift(version);
      this.compareVersionId = version.id;
    });
    this.notify('已保存当前证明快照');
  }

  notify(message: string): void {
    this.toast = message;
    window.setTimeout(() => {
      if (this.toast === message) {
        this.toast = '';
        redraw();
      }
    }, 2200);
  }
}

function stripLatexCommands(text: string): string {
  return text.replace(/\\[A-Za-z]+/g, ' ').replace(/[{}_^]/g, ' ');
}

export function isAlternativeActive(step: ProofStep): boolean {
  return step.alternativeEnabled === true && step.alternative.trim().length > 0;
}

export interface StepStatusInfo {
  statuses: Map<string, StepStatus>;
  sources: Map<string, Set<string>>;
}

// 带反例的步骤受质疑；由它推出的步骤进入待复核。启用替代分支后两者一起解除。
export function computeStepStatuses(document: ProofDocument): StepStatusInfo {
  const statuses = new Map<string, StepStatus>();
  const sources = new Map<string, Set<string>>();
  const ids = new Set(document.steps.map((step) => step.id));
  const dependents = new Map<string, string[]>();
  document.steps.forEach((step) => {
    step.references.forEach((reference) => {
      if (!ids.has(reference)) return;
      dependents.set(reference, [...(dependents.get(reference) ?? []), step.id]);
    });
  });
  const queue: string[] = [];
  document.steps.forEach((step) => {
    if (step.counterexample.trim() && !isAlternativeActive(step)) {
      statuses.set(step.id, 'questioned');
      sources.set(step.id, new Set([step.id]));
      queue.push(step.id);
    }
  });
  while (queue.length) {
    const currentId = queue.shift() as string;
    const currentSources = sources.get(currentId) ?? new Set<string>();
    (dependents.get(currentId) ?? []).forEach((next) => {
      const known = sources.get(next);
      const merged = new Set([...(known ?? []), ...currentSources]);
      if (known && merged.size === known.size) return;
      sources.set(next, merged);
      if (!statuses.has(next)) statuses.set(next, 'review');
      queue.push(next);
    });
  }
  return { statuses, sources };
}

export function validate(document: ProofDocument): ProofCheck[] {
  const checks: ProofCheck[] = [];
  const ids = new Set(document.steps.map((step) => step.id));
  const symbolKeys = new Set(Object.keys(document.symbols));
  const ignored = new Set(['a', 'A', 'b', 'B', 'n', 'k', 'P', 'Q', 'R', 'x', 'y', 'to', 'text', 'frac', 'sqrt']);

  document.steps.forEach((step, index) => {
    const tokens = stripLatexCommands(step.statement).match(/\b[A-Za-z][A-Za-z0-9']*\b/g) ?? [];
    const unknown = [...new Set(tokens.filter((token) => !symbolKeys.has(token) && !ignored.has(token)))];
    if (unknown.length) {
      checks.push({ id: `symbol-${step.id}`, severity: 'warning', title: '发现未定义符号', detail: `步骤 ${index + 1} 使用了：${unknown.join('、')}`, stepId: step.id });
    }

    step.references.forEach((reference) => {
      if (!ids.has(reference)) {
        checks.push({ id: `missing-${step.id}-${reference}`, severity: 'error', title: '引用步骤不存在', detail: `步骤 ${index + 1} 引用了已删除的步骤 ${reference}`, stepId: step.id });
      }
    });
  });

  const graph = new Map(document.steps.map((step) => [step.id, step.references.filter((id) => ids.has(id))]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycleStep = new Set<string>();
  const visit = (id: string, path: string[]): boolean => {
    if (visiting.has(id)) {
      path.slice(path.indexOf(id)).forEach((item) => cycleStep.add(item));
      return true;
    }
    if (visited.has(id)) return false;
    visiting.add(id);
    const hasCycle = (graph.get(id) ?? []).some((next) => visit(next, [...path, id]));
    visiting.delete(id);
    visited.add(id);
    return hasCycle;
  };
  [...graph.keys()].forEach((id) => visit(id, []));
  if (cycleStep.size) {
    checks.push({ id: 'cycle', severity: 'error', title: '检测到循环引用', detail: '引用链形成闭环，请调整步骤关系。', stepId: [...cycleStep][0] });
  }

  const { statuses, sources } = computeStepStatuses(document);
  document.steps.forEach((step, index) => {
    const status = statuses.get(step.id);
    if (status === 'questioned') {
      checks.push({ id: `challenged-${step.id}`, severity: 'error', title: '步骤受质疑', detail: `步骤 ${index + 1} 附有反例，该步推理暂不成立。可修正该步，或在检查器中启用其替代分支重新判定。`, stepId: step.id });
    } else if (status === 'review') {
      const sourceNumbers = [...(sources.get(step.id) ?? [])]
        .map((id) => document.steps.findIndex((item) => item.id === id) + 1)
        .filter((number) => number > 0)
        .sort((a, b) => a - b);
      checks.push({ id: `review-${step.id}`, severity: 'warning', title: '步骤待复核', detail: `步骤 ${index + 1} 依赖受质疑的步骤 ${sourceNumbers.join('、')}，推导需复核。`, stepId: step.id });
    }
  });

  const goalStep = document.steps.find((step) => step.type === 'goal' && step.rule === '结论');
  if (!goalStep) {
    checks.push({ id: 'goal-missing', severity: 'error', title: '目标未被证明', detail: '请添加“结论”类型的最终步骤。' });
  } else {
    const blocking = new Set<string>();
    if (statuses.has(goalStep.id)) blocking.add(goalStep.id);
    const stack = [...goalStep.references];
    const seen = new Set<string>();
    while (stack.length) {
      const id = stack.pop() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      if (statuses.has(id)) {
        blocking.add(id);
        continue;
      }
      (graph.get(id) ?? []).forEach((next) => stack.push(next));
    }
    if (blocking.size) {
      const numbers = [...blocking]
        .map((id) => document.steps.findIndex((step) => step.id === id) + 1)
        .filter((number) => number > 0)
        .sort((a, b) => a - b);
      checks.push({ id: 'goal-questioned', severity: 'error', title: '目标尚未证出', detail: `结论依赖受质疑或待复核的步骤 ${numbers.join('、')}，证明目标尚未证出。`, stepId: goalStep.id });
    } else if (goalStep.references.length === 0) {
      checks.push({ id: 'goal-unlinked', severity: 'warning', title: '结论尚无推导支撑', detail: '最终步骤没有引用任何前置步骤。', stepId: goalStep.id });
    }
  }

  if (!checks.some((check) => check.severity === 'error')) {
    checks.push({ id: 'proof-ok', severity: 'info', title: '结构检查通过', detail: '未发现缺失引用、循环引用或未证明目标。' });
  }
  return checks;
}

export function compareVersion(document: ProofDocument, version: ProofVersion) {
  const result = [];
  const size = Math.max(document.steps.length, version.steps.length);
  for (let index = 0; index < size; index += 1) {
    const before = version.steps[index]?.statement ?? '';
    const after = document.steps[index]?.statement ?? '';
    const kind = !before ? 'added' : !after ? 'removed' : before === after ? 'same' : 'changed';
    result.push({ kind, label: `步骤 ${index + 1}`, before, after } as const);
  }
  return result;
}

export function createId(prefix: string): string {
  return uid(prefix);
}
