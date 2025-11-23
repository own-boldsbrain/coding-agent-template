import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TaskForm } from './task-form'
import { Provider } from 'jotai'

// Mock dependencies
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}))

// Mock atoms
vi.mock('@/lib/atoms/github-cache', async () => {
  const { atom } = await import('jotai')
  const atoms = new Map()
  return {
    githubReposAtomFamily: (owner: string) => {
      if (!atoms.has(owner)) {
        atoms.set(owner, atom([]))
      }
      return atoms.get(owner)
    },
  }
})

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Loader2: () => <div data-testid="loader-icon">Loader2</div>,
  Loader2Icon: () => <div data-testid="loader-icon">Loader2</div>,
  ArrowUp: () => <div data-testid="arrow-up-icon">ArrowUp</div>,
  ArrowUpIcon: () => <div data-testid="arrow-up-icon">ArrowUp</div>,
  Settings: () => <div data-testid="settings-icon">Settings</div>,
  SettingsIcon: () => <div data-testid="settings-icon">Settings</div>,
  X: () => <div data-testid="x-icon">X</div>,
  XIcon: () => <div data-testid="x-icon">X</div>,
  Cable: () => <div data-testid="cable-icon">Cable</div>,
  CableIcon: () => <div data-testid="cable-icon">Cable</div>,
  Users: () => <div data-testid="users-icon">Users</div>,
  UsersIcon: () => <div data-testid="users-icon">Users</div>,
  ChevronDown: () => <div data-testid="chevron-down-icon">ChevronDown</div>,
  ChevronDownIcon: () => <div data-testid="chevron-down-icon">ChevronDown</div>,
  ChevronUp: () => <div data-testid="chevron-up-icon">ChevronUp</div>,
  ChevronUpIcon: () => <div data-testid="chevron-up-icon">ChevronUp</div>,
  Check: () => <div data-testid="check-icon">Check</div>,
  CheckIcon: () => <div data-testid="check-icon">Check</div>,
  Search: () => <div data-testid="search-icon">Search</div>,
  SearchIcon: () => <div data-testid="search-icon">Search</div>,
  Plus: () => <div data-testid="plus-icon">Plus</div>,
  PlusIcon: () => <div data-testid="plus-icon">Plus</div>,
}))

// Mock logos
vi.mock('@/components/logos', () => ({
  Claude: () => <div>Claude</div>,
  Codex: () => <div>Codex</div>,
  Copilot: () => <div>Copilot</div>,
  Cursor: () => <div>Cursor</div>,
  Gemini: () => <div>Gemini</div>,
  OpenCode: () => <div>OpenCode</div>,
  Qwen: () => <div>Qwen</div>,
  DeepSeek: () => <div>DeepSeek</div>,
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/lib/utils/cookies', () => ({
  setInstallDependencies: vi.fn(),
  setMaxDuration: vi.fn(),
  setKeepAlive: vi.fn(),
}))

vi.mock('@/components/connectors-provider', () => ({
  useConnectors: () => ({
    connectors: [],
    isLoading: false,
    refreshConnectors: vi.fn(),
  }),
}))

// Mock UI components to simplify testing
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, className, type }: any) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={className}
      type={type || 'button'}
      data-testid={type === 'submit' ? 'actual-submit-button' : 'other-button'}
    >
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/textarea', async () => {
  const React = await import('react')
  return {
    Textarea: React.forwardRef(({ value, onChange, placeholder, onKeyDown }: any, ref: any) => (
      <textarea
        ref={ref}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        onKeyDown={onKeyDown}
        data-testid="task-textarea"
      />
    )),
  }
})

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
  SelectTrigger: ({ children }: any) => <div data-testid="select-trigger">{children}</div>,
  SelectValue: ({ children }: any) => <span>{children}</span>,
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: any) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: any) => <div data-testid="dropdown-trigger">{children}</div>,
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
  TooltipProvider: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children }: any) => <div data-testid="tooltip-trigger">{children}</div>,
}))

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange }: any) => (
    <input type="checkbox" checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} />
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children }: any) => <label>{children}</label>,
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}))

describe('TaskForm', () => {
  const mockOnSubmit = vi.fn()
  const defaultProps = {
    onSubmit: mockOnSubmit,
    isSubmitting: false,
    selectedOwner: 'test-owner',
    selectedRepo: 'test-repo',
    initialInstallDependencies: true,
    initialMaxDuration: 300,
    initialKeepAlive: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Mock fetch for this test suite
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        if (url.toString().includes('/api/github/repos')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ repos: [] }),
          } as Response)
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        } as Response)
      }),
    )
  })

  it('should render the form correctly', () => {
    render(
      <Provider>
        <TaskForm {...defaultProps} />
      </Provider>,
    )

    expect(screen.getByTestId('task-textarea')).not.toBeNull()
    expect(screen.getByTestId('arrow-up-icon')).not.toBeNull()
  })

  it('should update prompt when typing', () => {
    render(
      <Provider>
        <TaskForm {...defaultProps} />
      </Provider>,
    )

    const textarea = screen.getByTestId('task-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'New task prompt' } })

    expect(textarea.value).toBe('New task prompt')
  })

  it('should call onSubmit when form is submitted', async () => {
    render(
      <Provider>
        <TaskForm {...defaultProps} />
      </Provider>,
    )

    const textarea = screen.getByTestId('task-textarea')
    fireEvent.change(textarea, { target: { value: 'Do something' } })

    const submitButton = screen.getByTestId('actual-submit-button')
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalled()
    })
  })

  it('should disable submit button when isSubmitting is true', () => {
    console.log('Running updated test')
    render(
      <Provider>
        <TaskForm {...defaultProps} isSubmitting={true} />
      </Provider>,
    )

    const submitButton = screen.getByTestId('actual-submit-button') as HTMLButtonElement
    expect(submitButton.disabled).toBe(true)
    expect(screen.getByTestId('loader-icon')).not.toBeNull()
  })
})
