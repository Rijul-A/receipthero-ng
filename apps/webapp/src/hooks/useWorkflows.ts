import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateWorkflow,
  UpdateWorkflow,
  Workflow,
} from '@sm-rn/shared/workflow-schemas'
import type { TestWorkflowResult } from '@/lib/server/workflows.functions'
import {
  createWorkflow as createWorkflowFn,
  deleteWorkflow as deleteWorkflowFn,
  getWorkflow as getWorkflowFn,
  getWorkflows as getWorkflowsFn,
  testWorkflow as testWorkflowFn,
  updateWorkflow as updateWorkflowFn,
  validateWorkflowSchema,
} from '@/lib/server/workflows.functions'

export type { TestWorkflowResult }

export function useWorkflows() {
  return useQuery<Array<Workflow>>({
    queryKey: ['workflows'],
    queryFn: () => getWorkflowsFn(),
  })
}

export function useWorkflow(id?: number) {
  return useQuery<Workflow>({
    queryKey: ['workflows', id],
    queryFn: () => getWorkflowFn({ data: { id: id! } }),
    enabled: !!id,
  })
}

export function useCreateWorkflow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateWorkflow) => createWorkflowFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
    },
  })
}

export function useUpdateWorkflow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateWorkflow }) =>
      updateWorkflowFn({ data: { id, data } }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      queryClient.invalidateQueries({ queryKey: ['workflows', id] })
    },
  })
}

export function useDeleteWorkflow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteWorkflowFn({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
    },
  })
}

export function useValidateSchema() {
  return useMutation({
    mutationFn: (zodSource: string) =>
      validateWorkflowSchema({ data: { zodSource } }),
  })
}

export function useTestWorkflow() {
  return useMutation<TestWorkflowResult, Error, { id: number; image: string }>({
    mutationFn: ({ id, image }) => testWorkflowFn({ data: { id, image } }),
  })
}
