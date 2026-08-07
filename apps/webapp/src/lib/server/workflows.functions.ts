/**
 * Workflow Server Functions
 *
 * Proxies workflow CRUD to the internal API, same as every other
 * *.functions.ts file - this used to be the one place in the webapp that
 * called the API directly from the browser (via fetchApi in
 * useWorkflows.ts), bypassing the session cookie entirely.
 */

import { createServerFn } from '@tanstack/react-start'
import { apiCall } from './api-client'
import type {
  CreateWorkflow,
  UpdateWorkflow,
  Workflow,
} from '@sm-rn/shared/workflow-schemas'

/**
 * List all workflows.
 * Proxies to GET /api/workflows.
 */
export const getWorkflows = createServerFn({ method: 'GET' }).handler(
  async () => {
    return apiCall<Array<Workflow>>('/api/workflows')
  },
)

/**
 * Get a single workflow.
 * Proxies to GET /api/workflows/:id.
 */
export const getWorkflow = createServerFn({ method: 'GET' })
  .inputValidator((input: { id: number }) => input)
  .handler(async ({ data }) => {
    return apiCall<Workflow>(`/api/workflows/${data.id}`)
  })

/**
 * Create a workflow.
 * Proxies to POST /api/workflows.
 */
export const createWorkflow = createServerFn({ method: 'POST' })
  .inputValidator((input: CreateWorkflow) => input)
  .handler(async ({ data }) => {
    return apiCall<Workflow>('/api/workflows', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  })

/**
 * Update a workflow.
 * Proxies to PUT /api/workflows/:id.
 */
export const updateWorkflow = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: number; data: UpdateWorkflow }) => input)
  .handler(async ({ data }) => {
    return apiCall<Workflow>(`/api/workflows/${data.id}`, {
      method: 'PUT',
      body: JSON.stringify(data.data),
    })
  })

/**
 * Delete a workflow.
 * Proxies to DELETE /api/workflows/:id.
 */
export const deleteWorkflow = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: number }) => input)
  .handler(async ({ data }) => {
    return apiCall<{ success: boolean }>(`/api/workflows/${data.id}`, {
      method: 'DELETE',
    })
  })

export interface ValidateSchemaResult {
  valid: boolean
  jsonSchema?: object
  errors?: Array<string>
}

/**
 * Validates a Zod schema source string without saving anything.
 * Proxies to POST /api/workflows/validate-schema.
 */
export const validateWorkflowSchema = createServerFn({ method: 'POST' })
  .inputValidator((input: { zodSource: string }) => input)
  .handler(async ({ data }) => {
    return apiCall<ValidateSchemaResult>('/api/workflows/validate-schema', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  })

export interface TestWorkflowResult {
  items: Array<unknown>
  workflowId: number
  workflowName: string
}

/**
 * Runs a workflow's extraction against a base64-encoded test image.
 * Proxies to POST /api/workflows/:id/test.
 *
 * Note: cast used due to a TanStack Start typing limitation inferring the
 * return shape from `items: unknown[]` (same workaround as saveConfig in
 * config.functions.ts).
 */
export const testWorkflow = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: number; image: string }) => input)
  .handler((async ({ data }: any) => {
    return apiCall<TestWorkflowResult>(`/api/workflows/${data.id}/test`, {
      method: 'POST',
      body: JSON.stringify({ image: data.image }),
    })
  }) as any) as (opts: {
  data: { id: number; image: string }
}) => Promise<TestWorkflowResult>
