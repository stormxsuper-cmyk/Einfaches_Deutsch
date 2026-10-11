import { getAccessToken } from './auth';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
export type CurriculumModule = { id: string; title: string; vocabulary_scope: string; grammar_scope: string; learning_outcome: string; assessment: string };
export type CurriculumLevel = { level: string; purpose: string; modules: CurriculumModule[] };
export type Curriculum = { project: string; version: string; alignment: string; mastery_policy: { skill_dimensions: string[]; mastery_evidence: string[]; gate_policy: string }; levels: CurriculumLevel[] };
async function request<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers || {}) } });
  if (response.status === 401 && token && !retried && (await getAccessToken(true))) return request<T>(path, init, true);
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `API request failed (${response.status})`); }
  return response.json() as Promise<T>;
}
export const getHealth = () => request<{ status: string; database: string; curriculumVersion?: string; levels?: number; modules?: number }>('/health');
export const getKnowledge = () => request<Array<{code:string;title:string;level:string;category:string;description?:string;prerequisites?:string[]}>>('/knowledge');
export const getCurriculum = () => request<Curriculum>('/curriculum');
export const getMistakes = () => request<Array<{is_resolved:boolean}>>('/mistakes');
export const generatePlan = (availableMinutes: number, masteryList: unknown[], mistakes: unknown[]) => request<Array<{id:string;title:string;type:string;durationMinutes:number}>>('/planner/generate', { method:'POST', body:JSON.stringify({availableMinutes,masteryList,mistakes}) });
export const submitReview = (data: {qualityScore:number;currentEase?:number;currentInterval?:number;currentMastery?:number}) => request<{newInterval:number;newEaseFactor:number;newMasteryScore:number;nextReviewDate:string}>('/mastery/review', {method:'POST',body:JSON.stringify(data)});
export type Me = { id: string; display_name: string; target_level: string; verified_level: string | null; email: string | null };
export const getMe = () => request<Me>('/me');
export const updateMe = (data: { display_name?: string; target_level?: string }) => request<Me>('/me', { method: 'PUT', body: JSON.stringify(data) });
export const deleteMyData = () => request<{ deleted: boolean }>('/me', { method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE' }) });
export type PushResult = { index: number; table?: string; status: 'applied' | 'duplicate' | 'conflict' | 'rejected'; reason?: string; server_row?: Record<string, unknown> };
export const syncPush = (body: { device_id: string; changes: unknown[] }) => request<{ results: PushResult[]; server_time: string }>('/sync/push', { method: 'POST', body: JSON.stringify(body) });
export const syncPull = (since: string) => request<{ cursor: string; has_more: boolean; changes: Array<{ table: string; row: Record<string, unknown> }> }>(`/sync/pull?since=${encodeURIComponent(since)}`);
