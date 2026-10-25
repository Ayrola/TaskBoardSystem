import { supabaseClient } from './supabase-client.js';
import { isUuid } from '../utils/validation.js';
export const TASK_LIST_PAGE_SIZE=20;
export async function listProjectTasks({status='all',projectId,page=1,signal}={}) {
  if (!['all','open','done'].includes(status)) throw new Error('Choose All, Open or Done tasks.');
  if (!isUuid(projectId)) throw new Error('Invalid project filter.');
  const offset=(Math.max(1,Math.floor(page)||1)-1)*TASK_LIST_PAGE_SIZE;
  // Exact count and filters cover the entire RLS-visible dataset before range pagination.
  let query=supabaseClient.from('tasks').select('id,title,done,project_id,projects(title),project_stages(name)',{count:'exact'})
    .order('created_at',{ascending:false}).order('id');
  if (status!=='all') query=query.eq('done',status==='done');
  if (projectId) query=query.eq('project_id',projectId);
  query=query.range(offset,offset+TASK_LIST_PAGE_SIZE-1);
  if (signal) query=query.abortSignal(signal);
  const {data,count,error}=await query;
  if (error || count === null) throw new Error('Could not load tasks. Please try again.');
  return {rows:data??[],total:Number(count??0)};
}
