import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLogin } from '../lib/queries'
import { Route } from '../routes/login'
import { createTestQueryClient } from './setup'

vi.mock('../lib/queries', () => ({
  useLogin: vi.fn(),
}))

const mockUseLogin = useLogin as ReturnType<typeof vi.fn>
const LoginPage = Route.options.component!

function renderLogin() {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <LoginPage />
    </QueryClientProvider>,
  )
}

describe('Login Page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseLogin.mockReturnValue({ mutate: vi.fn(), isPending: false })
  })

  it('renders username and password fields', () => {
    renderLogin()

    expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('rejects submitting with an empty username or password', async () => {
    const mockMutate = vi.fn()
    mockUseLogin.mockReturnValue({ mutate: mockMutate, isPending: false })

    renderLogin()
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(toast.error).toHaveBeenCalledWith(
      'Enter your Paperless-NGX username and password',
    )
    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('submits the trimmed username and password', async () => {
    const mockMutate = vi.fn()
    mockUseLogin.mockReturnValue({ mutate: mockMutate, isPending: false })

    renderLogin()
    await userEvent.type(screen.getByLabelText(/username/i), '  rijul  ')
    await userEvent.type(screen.getByLabelText(/password/i), 'hunter2')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(mockMutate).toHaveBeenCalledWith(
      { username: 'rijul', password: 'hunter2' },
      expect.anything(),
    )
  })

  it('shows an error toast when login fails', async () => {
    const mockMutate = vi.fn((_vars, opts) =>
      opts?.onError?.(new Error('Invalid Paperless username or password')),
    )
    mockUseLogin.mockReturnValue({ mutate: mockMutate, isPending: false })

    renderLogin()
    await userEvent.type(screen.getByLabelText(/username/i), 'rijul')
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(toast.error).toHaveBeenCalledWith(
      'Invalid Paperless username or password',
    )
  })
})
