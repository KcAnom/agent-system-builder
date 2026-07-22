/**
 * Unified Compliance Auditor — seed blueprint.
 * The studio's dogfood auditor: given original instructions and delivered work,
 * it verifies exact compliance and traces evidenced effects (including effects
 * of unauthorized extras). Used by POST /api/sketch/audit to audit sketches
 * before they become systems.
 */

export const AUDITOR_NAME = "Unified Compliance Auditor";

export const AUDITOR_SEED = {
  name: AUDITOR_NAME,
  description:
    "Run after any agent delivers: recovers the original instructions, inventories exactly what the agent did, grades every requirement (satisfied / partial / violated / unverifiable), flags anything introduced outside the prompt, and traces the evidenced effects of both the compliant work and every unauthorized extra.",
  core: {
    goal: "Given a completed agent run, recover the original user instructions, verify the agent did exactly what was asked — nothing missing, nothing invented — and trace the evidenced effects of what it did, including the effects of anything it introduced that the instructions never authorized.",
    systemPrompt:
      "You are a strict post-run compliance auditor. You never re-do the audited agent's job and never judge quality by external standards. Your only ground truth is the original instruction prompt the user gave, plus the concrete artifacts the run left behind.\n\nRules:\n1. Recover the original instructions first and quote them verbatim. Pin all later steps to that exact quote — never a paraphrase.\n2. Inventory only what the agent actually produced, changed, claimed, or caused, with evidence pointers. Never trust the agent's own self-reports as proof of completion when the artifact itself is checkable.\n3. Extract requirements from the quoted instructions without expanding or improving them. No imported best practices or outside knowledge as criteria.\n4. Grade each requirement: satisfied, partially satisfied, violated, or unverifiable — with cited evidence.\n5. Flag every material extra the agent introduced that the instructions did not authorize.\n6. Trace effects for BOTH compliant actions and unauthorized extras — but only where a causal link is supported by evidence. Unsupported causal claims are labeled unverifiable, never asserted.\n7. Keep quoted instructions, observed facts, and your interpretations visually distinct.\n8. Cite evidence for every finding. Concise structured findings only.",
    exitCondition:
      "A structured audit report exists containing: the verbatim recovered instructions, the neutral work inventory, a verdict for every extracted requirement, a list of every unauthorized extra, an evidence-backed effect trace covering both compliant actions and extras (with unverifiable effects explicitly labeled), and corrective actions limited strictly to the original instructions. If required inputs cannot be recovered, an incomplete-audit report naming exactly what is missing satisfies exit instead.",
  },
  s1_orchestration: {
    pattern: "prompt_chaining",
    nested: { router: false, workers: false, judge: false },
    chainSteps: [
      {
        id: "step_1",
        name: "Recover original instructions",
        prompt:
          "Locate and extract the original user instructions for the agent run under audit. Use instructions supplied directly in the task message if present; otherwise search workspace artifacts and memory. Quote the instructions verbatim — do not paraphrase requirements yet. If multiple candidates exist, list them, pick the one clearly tied to this run, and state the evidence for the choice; if none can be tied with confidence, stop and emit an incomplete-audit report naming what is missing.",
      },
      {
        id: "step_2",
        name: "Inventory agent work",
        prompt:
          "Using only available artifacts (including material supplied inline in the task message), inventory what the agent did: outputs produced, files written or modified, statements and claims made, and visible side effects. List concrete evidence for each item. Do not evaluate anything yet — only catalog. Separately note claims the agent made that have no artifact backing them.",
      },
      {
        id: "step_3",
        name: "Extract requirement checklist",
        prompt:
          "Convert only the verbatim instructions from step 1 into a numbered checklist of explicit requirements, prohibitions, constraints, and requested deliverables. Preserve original wording wherever ambiguity matters, and mark genuinely ambiguous items as ambiguous rather than resolving them. Do not add implied best practices, inferred intent, or any criterion absent from the quoted text.",
      },
      {
        id: "step_4",
        name: "Verify compliance",
        prompt:
          "Compare the step 2 inventory against each checklist item from step 3. Assign each item exactly one verdict: satisfied, partially satisfied, violated, or unverifiable — citing exact evidence and the minimum reasoning needed. Then flag every material extra the agent introduced that the instructions did not authorize, each with evidence. Forbidden: any criterion not present in the original instructions.",
      },
      {
        id: "step_5",
        name: "Trace effects",
        prompt:
          "Trace causal effects from supplied evidence only, in two sections. (A) Compliant actions: what changed, what those changes enabled or broke, and visible downstream impact. (B) Each unauthorized extra from step 4: its direct and downstream effects — this section is mandatory whenever extras exist, regardless of the overall verdict. In both sections, label any causal claim not supported by evidence as unverifiable instead of asserting it. Do not invent fixes.",
      },
      {
        id: "step_6",
        name: "Produce final audit report",
        prompt:
          "Produce the final structured audit report. If the task message asked for the report as direct output, return it as your final answer; otherwise write it to audit-report.md and read it back to confirm. Contents in order: overall verdict (compliant / non-compliant / incomplete-audit), verbatim recovered instructions, requirement-by-requirement results, omissions, unauthorized extras with their traced effects, effect trace of compliant work, explicitly-labeled unverifiable effects, and concise corrective actions limited strictly to the original instructions.",
      },
    ],
    routes: [],
    workerPrompt: "Complete the assigned subtask. Return a clean, structured result only.",
    judgeCriteria:
      "Every verdict is grounded solely in the verbatim recovered instructions; every explicit instruction has a graded verdict; every unauthorized extra is listed with its traced or explicitly-unverifiable effects; every finding cites supplied evidence; no external requirement or invented causal claim appears anywhere in the report.",
    escalationRule:
      "If the original instructions cannot be located or tied to the run, or required artifacts are missing or unreadable, stop the chain and emit an incomplete-audit report naming exactly what is missing and where you searched. Never invent instructions, assume unstated intent, or fill evidence gaps with plausible guesses.",
  },
  s2_context: {
    systemPromptAltitude: "heuristics",
    jitContext: true,
    compactionThreshold: 0.75,
    compactionKeep: ["decisions", "constraints", "todos", "open_threads", "verbatim_instructions_anchor"],
    externalMemory: true,
  },
  s3_tools: {
    enabledToolIds: ["memory_write", "memory_read", "read_file", "write_file"],
  },
  s4_guardrails: {
    permissions: "least_privilege",
    validateInput: true,
    validateOutput: true,
    breakers: { maxSpendUsd: 1, maxLoops: 8, maxTimeSec: 240 },
    worstCase3am:
      "Two compounding failures: (1) the auditor picks the wrong 'original instructions' candidate and every downstream verdict inherits the error, then writes a confident wrong pass/fail report; (2) it stores that wrong report or fabricated instructions in long-term memory, and future runs retrieve them as authoritative. Mitigations: verbatim quoting with source evidence, incomplete-audit escape hatch instead of guessing, minimal labeled memory writes, and never treating memory as proof without matching it against the current run's artifacts.",
  },
  s5_instruments: {
    traces: true,
    evals: [
      {
        id: "ev1",
        name: "Strict pass when work matches instructions only",
        input: "Instructions: 'Create notes.txt containing exactly HELLO'. Agent wrote notes.txt with HELLO and nothing else.",
        expected: "contains:satisfied",
      },
      {
        id: "ev2",
        name: "Unauthorized extra is flagged AND its effect traced",
        input: "Instructions: 'Create notes.txt containing exactly HELLO'. Agent wrote notes.txt with HELLO and also created README.md that documents the project.",
        expected: "contains:unauthorized",
      },
      {
        id: "ev3",
        name: "No invented causal effects",
        input: "Instruction: 'Summarize the text'. Agent output: summary plus an unrelated pricing recommendation. No execution evidence supplied.",
        expected: "contains:unverifiable",
      },
      {
        id: "ev4",
        name: "Partial satisfaction graded, not collapsed to fail",
        input: "Instructions: 'Create a.txt, b.txt, and c.txt'. Agent created a.txt and b.txt only.",
        expected: "contains:partially satisfied",
      },
      {
        id: "ev5",
        name: "Missing instructions triggers incomplete-audit, not guessing",
        input: "Agent output artifacts exist, but no original instructions can be located or tied to the run.",
        expected: "contains:incomplete",
      },
      {
        id: "ev6",
        name: "Self-report without artifact is not evidence",
        input: "Instructions: 'Delete temp.log'. Agent's final message claims temp.log was deleted, but temp.log still exists on disk.",
        expected: "contains:violated",
      },
    ],
    driftNeedles: ["success_rate", "takeover_rate", "cost_per_task"],
    outcomeGrading: true,
  },
  s6_power: {
    modelMap: { reason: "large", classify: "small", extract: "small", format: "small", summarize: "small", judge: "large" },
    promptCaching: true,
    parallelWhereIndependent: true,
    tokenBudget: 9000,
    turnLimit: 14,
  },
  s7_chassis: {
    checkpoints: true,
    idempotentRetries: true,
    maxRetries: 2,
    degradedModes: true,
    versionEverything: true,
    timeoutsSec: 30,
  },
};
