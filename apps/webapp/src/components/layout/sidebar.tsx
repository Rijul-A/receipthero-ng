import { useState } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import {
  BarChart3,
  ListChecks,
  LogOut,
  Menu,
  PieChart,
  Receipt,
  Settings,
  TrendingDown,
  Workflow,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLogout } from '@/lib/queries'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: Receipt, exact: true },
  { to: '/receipts', label: 'Receipts', icon: ListChecks, exact: false },
  { to: '/prices', label: 'Prices', icon: TrendingDown, exact: false },
  { to: '/reports', label: 'Reports', icon: BarChart3, exact: false },
  { to: '/analytics', label: 'Analytics', icon: PieChart, exact: false },
  { to: '/workflows', label: 'Workflows', icon: Workflow, exact: false },
] as const

export function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const logout = useLogout()
  const [mobileOpen, setMobileOpen] = useState(false)

  const isActive = (to: string, exact?: boolean) =>
    exact ? location.pathname === to : location.pathname.startsWith(to)

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => void navigate({ to: '/login' }),
      onError: (error) => toast.error(error.message),
    })
  }

  const navContent = (
    <>
      <div className="px-4 py-5">
        <Link
          to="/"
          className="text-lg font-bold tracking-tight"
          onClick={() => setMobileOpen(false)}
        >
          ReceiptHero
        </Link>
      </div>
      <nav className="flex-1 px-2 space-y-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon, exact }) => (
          <Link
            key={to}
            to={to}
            onClick={() => setMobileOpen(false)}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 text-sm rounded-none transition-colors',
              isActive(to, exact)
                ? 'bg-foreground text-background font-medium'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="px-2 pb-4 pt-2 border-t space-y-1">
        <Link
          to="/settings"
          onClick={() => setMobileOpen(false)}
          className={cn(
            'flex items-center gap-2.5 px-3 py-2 text-sm rounded-none transition-colors',
            isActive('/settings')
              ? 'bg-foreground text-background font-medium'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          Settings
        </Link>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2.5 px-3 text-muted-foreground hover:text-foreground"
          onClick={handleLogout}
          disabled={logout.isPending}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Log out
        </Button>
      </div>
    </>
  )

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden flex items-center justify-between border-b px-4 py-3 bg-background">
        <span className="text-base font-bold tracking-tight">ReceiptHero</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      {/* Mobile off-canvas panel */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-64 bg-background border-r flex flex-col">
            <div className="flex items-center justify-end px-2 pt-2">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            {navContent}
          </div>
        </div>
      )}

      {/* Desktop persistent sidebar */}
      <div className="hidden md:flex md:flex-col w-56 shrink-0 border-r bg-background">
        {navContent}
      </div>
    </>
  )
}
