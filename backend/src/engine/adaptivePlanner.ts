export interface DailyTask { id: string; title: string; type: 'MISTAKE_RECOVERY'|'REVIEW'|'NEW_LEARNING'; durationMinutes: number; }
export function generateDailyPlan(availableMinutes: number, masteryList: any[] = [], mistakes: any[] = []): DailyTask[] {
 if (!Number.isInteger(availableMinutes) || availableMinutes < 1 || availableMinutes > 480) throw new Error('availableMinutes must be an integer from 1 to 480');
 const tasks: DailyTask[] = []; let left = availableMinutes;
 const add=(id:string,title:string,type:DailyTask['type'],desired:number)=>{const duration=Math.min(desired,left); if(duration>0){tasks.push({id,title,type,durationMinutes:duration});left-=duration;}};
 if(mistakes.some(m=>!m.is_resolved)) add('task_mistakes','Correct previous mistakes','MISTAKE_RECOVERY',Math.min(15,Math.ceil(availableMinutes*0.3)));
 const due=masteryList.filter(m=>!m.next_review || new Date(m.next_review).getTime()<=Date.now());
 if(left>0 && (due.length>0 || tasks.length===0)) add('task_review','Review due words and grammar','REVIEW',Math.min(15,Math.ceil(availableMinutes*0.4)));
 if(left>0) add('task_new','Learn new CEFR concepts','NEW_LEARNING',left);
 return tasks;
}
