export type CefrLevel = 'Foundation'|'A1'|'A2'|'B1'|'B2';
export interface PlacementState { currentLevel:CefrLevel; questionsAnswered:number; consecutiveCorrect:number; consecutiveWrong:number; isComplete:boolean; }
const levels:CefrLevel[]=['Foundation','A1','A2','B1','B2'];
export function startPlacementTest(level:CefrLevel='Foundation'):PlacementState { if(!levels.includes(level)) throw new Error('Invalid level'); return {currentLevel:level,questionsAnswered:0,consecutiveCorrect:0,consecutiveWrong:0,isComplete:false}; }
export function processPlacementAnswer(state:PlacementState,isCorrect:boolean):PlacementState {
 if(state.isComplete) return state; const idx=levels.indexOf(state.currentLevel); state.questionsAnswered++;
 if(isCorrect){state.consecutiveCorrect++;state.consecutiveWrong=0;if(state.consecutiveCorrect>=3&&idx<levels.length-1){state.currentLevel=levels[idx+1];state.consecutiveCorrect=0;}}
 else {state.consecutiveWrong++;state.consecutiveCorrect=0;if(state.consecutiveWrong>=2&&idx>0){state.currentLevel=levels[idx-1];state.consecutiveWrong=0;}}
 if(state.questionsAnswered>=15 || state.consecutiveWrong>=4) state.isComplete=true; return state;
}
