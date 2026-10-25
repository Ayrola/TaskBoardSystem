import { supabaseClient } from './supabase-client.js';
import { isUuid } from '../utils/validation.js';
import { validateReportOptions } from '../reports/report-metrics.js';
export async function fetchProjectReport(projectId, options, { signal } = {}) {
  if (!isUuid(projectId)) throw new Error('Project not found.');
  validateReportOptions(options);
  let query = supabaseClient.rpc('project_statistics_report', { p_project_id: projectId, p_days: options.period==='custom'?null:Number(options.period), p_start:options.period==='custom'?options.start:null, p_end:options.period==='custom'?options.end:null, p_timezone:options.timezone });
  if(signal)query=query.abortSignal(signal);
  const {data,error}=await query;
  if(error?.code==='P0002'||error?.code==='28000'||error?.code==='42501')throw new Error('You no longer have access to this project report.');
  if(error||!data)throw new Error('Could not load the project report. Please try again.');
  if(data.project?.id!==projectId)throw new Error('The report does not match the active project.');
  return data;
}
// Recheck before download as generation of a large report may take time.
export async function verifyReportAccess(projectId, {signal}={}) {
  let query=supabaseClient.rpc('can_access_project',{p_project_id:projectId});if(signal)query=query.abortSignal(signal);
  const {data,error}=await query;if(error||data!==true)throw new Error('Project access changed. The report was not downloaded.');
}
