const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-tests-'));
function loadTs(relative) {
  const source = fs.readFileSync(path.join(root, 'src', relative), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const target = path.join(tmp, relative.replace(/\.ts$/, '.js'));
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, js);
  return require(target);
}
try {
  const mastery = loadTs('engine/masteryEngine.ts');
  const planner = loadTs('engine/adaptivePlanner.ts');
  const placement = loadTs('engine/placementTest.ts');
  const result = mastery.calculateSpacedRepetition(4, 2.5, 1, 20);
  assert.equal(result.newInterval, 6, 'second successful review should schedule six days');
  assert.ok(result.newMasteryScore >= 0 && result.newMasteryScore <= 100);
  assert.throws(() => mastery.calculateSpacedRepetition(6), /qualityScore/);
  const plan = planner.generateDailyPlan(35, [], [{ is_resolved: false }]);
  assert.equal(plan.reduce((n, task) => n + task.durationMinutes, 0), 35, 'plan must fit available time exactly');
  assert.equal(plan[0].type, 'MISTAKE_RECOVERY', 'mistakes should be prioritized');
  assert.throws(() => planner.generateDailyPlan(0), /availableMinutes/);
  let state = placement.startPlacementTest('A1');
  state = placement.processPlacementAnswer(state, true);
  assert.equal(state.questionsAnswered, 1);
  assert.throws(() => placement.startPlacementTest('C2'), /Invalid level/);
  const curriculum = JSON.parse(fs.readFileSync(path.join(root, 'src/data/curriculum_master.json'), 'utf8'));
  assert.deepEqual(curriculum.levels.map(x => x.level), ['Foundation','A1','A2','B1','B2']);
  assert.equal(curriculum.levels.reduce((n, x) => n + x.modules.length, 0), 54);
  const ids = curriculum.levels.flatMap(x => x.modules.map(m => m.id));
  assert.equal(new Set(ids).size, ids.length, 'unit IDs must be unique');
  console.log('PASS: mastery, planner, placement basics, curriculum levels, 54 modules, unique IDs');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
