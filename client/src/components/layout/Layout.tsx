import React, { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useCircle } from '../../contexts/CircleContext';
import { useTheme } from '../../contexts/ThemeContext';
import {
    Home,
    BookOpen,
    Calendar as CalendarIcon,
    Pill,
    Activity,
    CheckSquare,
    ShoppingCart,
    MessageCircle,
    Wallet,
    FolderOpen,
    BookUser,
    Users,
    HeartHandshake,
    Settings,
    Moon,
    Sun,
    LogOut,
    Menu,
    X,
    Plus,
    WifiOff,
    Plug,
    RefreshCw,
    DoorOpen,
    ClipboardList,
    LayoutDashboard,
    ShieldCheck,
    Search,
    Sprout,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { subscribe as subscribeToWriteQueue } from '../../lib/offlineQueue';
import { Button } from '../ui/Button';
import { NotificationBell } from '../ui/NotificationBell';
import { DemoBanner } from '../app/DemoBanner';
import { CircleSwitcher } from '../app/CircleSwitcher';

interface LayoutProps {
    children: ReactNode;
}

/* Navigation en six groupes (revue produit) : Aujourd'hui, Soins, Organiser, Informations, Equipe, Plus. */
interface NavItem {
    labelKey: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    /** Roles pour lesquels l'entree est masquee (le serveur refuse de toute facon). */
    hideFor?: string[];
}

// Le role neighbor n'a pas acces aux donnees de sante ni aux documents (matrice docs/SPEC.md).
const HEALTH_HIDDEN = ['neighbor'];
// Hearth (presence) n'est montre qu'aux roles famille ; pour les autres, "/" reste le tableau de bord.
const HEARTH_HIDDEN = ['neighbor', 'professional'];

const NAV_GROUPS: Array<{ key: string; items: NavItem[] }> = [
    { key: 'today', items: [
        { labelKey: 'items.hearth', href: '/', icon: Home, hideFor: HEARTH_HIDDEN },
        { labelKey: 'items.today', href: '/today', icon: LayoutDashboard },
        { labelKey: 'items.journal', href: '/journal', icon: BookOpen },
        { labelKey: 'items.calendar', href: '/calendar', icon: CalendarIcon },
        { labelKey: 'items.messages', href: '/messages', icon: MessageCircle },
    ] },
    { key: 'care', items: [
        { labelKey: 'items.carePlan', href: '/care-plan', icon: ClipboardList },
        { labelKey: 'items.medications', href: '/medications', icon: Pill, hideFor: HEALTH_HIDDEN },
        { labelKey: 'items.health', href: '/health', icon: Activity, hideFor: HEALTH_HIDDEN },
        { labelKey: 'items.visitors', href: '/visitors', icon: DoorOpen },
    ] },
    { key: 'organise', items: [
        { labelKey: 'items.tasks', href: '/tasks', icon: CheckSquare },
        { labelKey: 'items.shopping', href: '/shopping', icon: ShoppingCart },
        { labelKey: 'items.expenses', href: '/expenses', icon: Wallet },
    ] },
    { key: 'information', items: [
        { labelKey: 'items.recipient', href: '/recipient', icon: HeartHandshake },
        { labelKey: 'items.contacts', href: '/contacts', icon: BookUser },
        { labelKey: 'items.documents', href: '/documents', icon: FolderOpen, hideFor: HEALTH_HIDDEN },
    ] },
    { key: 'team', items: [
        { labelKey: 'items.circle', href: '/circle', icon: Users },
    ] },
    { key: 'more', items: [
        { labelKey: 'items.trust', href: '/hearth/trust', icon: ShieldCheck, hideFor: HEARTH_HIDDEN },
        { labelKey: 'items.integrations', href: '/integrations', icon: Plug },
        { labelKey: 'items.settings', href: '/settings', icon: Settings },
    ] },
];

const allNavigation: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

const mobileTabs = [
    { labelKey: 'mobile.home', href: '/', icon: Home },
    { labelKey: 'mobile.journal', href: '/journal', icon: BookOpen },
    { labelKey: 'mobile.calendar', href: '/calendar', icon: CalendarIcon },
    { labelKey: 'mobile.medications', href: '/medications', icon: Pill },
    { labelKey: 'mobile.messages', href: '/messages', icon: MessageCircle },
];

const quickActions = [
    { labelKey: 'quickActions.addJournalEntry', href: '/journal', icon: BookOpen },
    { labelKey: 'quickActions.addEvent', href: '/calendar', icon: CalendarIcon },
    { labelKey: 'quickActions.addTask', href: '/tasks', icon: CheckSquare },
    { labelKey: 'quickActions.addShopping', href: '/shopping', icon: ShoppingCart },
    { labelKey: 'quickActions.addExpense', href: '/expenses', icon: Wallet },
];

const isRouteActive = (pathname: string, href: string) => {
    if (href === '/') {
        return pathname === '/';
    }
    return pathname === href || pathname.startsWith(`${href}/`);
};

const Layout: React.FC<LayoutProps> = ({ children }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const [query, setQuery] = React.useState('');
    const { t } = useTranslation('nav');
    const { user, logout } = useAuth();
    const { myRole } = useCircle();
    const { setTheme, actualTheme } = useTheme();
    const [sidebarOpen, setSidebarOpen] = React.useState(false);
    const [quickActionsOpen, setQuickActionsOpen] = React.useState(false);
    const [isOffline, setIsOffline] = React.useState(!navigator.onLine);
    const [pendingWrites, setPendingWrites] = React.useState(0);

    React.useEffect(() => {
        const goOnline = () => setIsOffline(false);
        const goOffline = () => setIsOffline(true);
        window.addEventListener('online', goOnline);
        window.addEventListener('offline', goOffline);
        return () => {
            window.removeEventListener('online', goOnline);
            window.removeEventListener('offline', goOffline);
        };
    }, []);

    // Taille de la file d'écritures hors ligne (lib/offlineQueue.ts): affichée
    // dans le bandeau hors ligne, et via un bandeau "Synchronisation" en ligne.
    React.useEffect(() => subscribeToWriteQueue(setPendingWrites), []);

    const currentPage = allNavigation.find((item) => isRouteActive(location.pathname, item.href));

    const toggleTheme = () => {
        setTheme(actualTheme === 'dark' ? 'light' : 'dark');
    };

    const closeMenus = () => {
        setSidebarOpen(false);
        setQuickActionsOpen(false);
    };

    const renderNavItems = (items: NavItem[]) =>
        items.map((item) => {
            const Icon = item.icon;
            const active = isRouteActive(location.pathname, item.href);
            return (
                <Link
                    key={item.labelKey}
                    to={item.href}
                    onClick={closeMenus}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                        'group relative flex items-center gap-3 rounded-[12px] px-3.5 py-2.5 text-[15px] font-medium',
                        'transition-colors duration-fast ease-soft',
                        active
                            ? 'bg-primary-soft text-primary'
                            : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'
                    )}
                >
                    <Icon
                        className={cn(
                            'h-5 w-5',
                            active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                        )}
                    />
                    <span>{t(item.labelKey)}</span>
                </Link>
            );
        });

    return (
        <div className="app-shell min-h-screen bg-background font-sans text-foreground">
            {/* Lien d'evitement : premiere tabulation, il saute la navigation. */}
            <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-input focus:bg-card focus:px-4 focus:py-2 focus:text-caption focus:font-medium focus:text-foreground focus:shadow-surface-hover focus:outline-none focus:ring-2 focus:ring-ring"
            >
                {t('skipToContent')}
            </a>
            {(sidebarOpen || quickActionsOpen) && (
                <div
                    className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
                    onClick={closeMenus}
                />
            )}

            <aside
                className={cn(
                    'fixed left-0 top-0 z-50 h-full w-72 border-r border-border bg-card shadow-surface',
                    'transform transition-transform duration-base ease-soft lg:translate-x-0',
                    sidebarOpen ? 'translate-x-0' : '-translate-x-full'
                )}
            >
                <div className="flex h-full flex-col">
                    <div className="flex h-20 items-center justify-between px-6">
                        <Link to="/" className="flex items-center gap-2.5" onClick={closeMenus}>
                            <img src={`${import.meta.env.BASE_URL}hearth-mark.svg`} alt="" className="h-9 w-9 object-contain" />
                            <span className="font-display text-[30px] font-medium leading-none tracking-[-0.02em] text-foreground" style={{ fontVariationSettings: '"opsz" 96' }}>Hearth</span>
                        </Link>
                        <button
                            type="button"
                            onClick={() => setSidebarOpen(false)}
                            className="rounded-input p-2 text-muted-foreground hover:bg-surface-2 lg:hidden"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>

                    <div className="px-4 pb-2">
                        <CircleSwitcher onNavigate={closeMenus} />
                    </div>

                    <nav aria-label={t('primaryNav')} className="flex-1 overflow-y-auto px-4 py-3 scrollbar-hide">
                        {NAV_GROUPS.map((group, index) => {
                            const items = group.items.filter((item) => !item.hideFor || !myRole || !item.hideFor.includes(myRole));
                            if (items.length === 0) return null;
                            return (
                                <div key={group.key} role="group" aria-label={t(`sections.${group.key}`)} className={cn(index > 0 && 'mt-3 border-t border-border pt-3')}>
                                    <div className="space-y-0.5">{renderNavItems(items)}</div>
                                </div>
                            );
                        })}
                    </nav>

                    <div className="p-4">
                        <div className="relative overflow-hidden rounded-[18px] bg-[linear-gradient(160deg,#eef4ec,#f6f3ec)] p-4 dark:bg-none dark:bg-surface-2">
                            <Sprout aria-hidden="true" className="absolute -bottom-3 -left-2 h-20 w-20 -rotate-12 text-[#2e5e45]/20" />
                            <p className="relative ml-14 text-caption leading-5 text-muted-foreground">{t('builtFor')}</p>
                        </div>
                    </div>
                </div>
            </aside>

            <div className="lg:pl-72">
                <DemoBanner />
                <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
                    <div className="mx-auto flex h-16 max-w-[1560px] items-center justify-between gap-4 px-4 lg:px-8">
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => {
                                    setQuickActionsOpen(false);
                                    setSidebarOpen(true);
                                }}
                                className="rounded-input p-2 text-muted-foreground hover:bg-surface-2 lg:hidden"
                                aria-label={t('user.openMenu')}
                            >
                                <Menu className="h-5 w-5" />
                            </button>
                            <h1 className="text-caption font-semibold text-foreground lg:hidden">
                                {currentPage ? t(currentPage.labelKey) : t('pageTitleFallback')}
                            </h1>
                        </div>

                        {/* Ask or search: a question goes to Ask Hearth on the home page. */}
                        <form role="search" className="hidden max-w-[460px] flex-1 md:block"
                            onSubmit={(e) => { e.preventDefault(); const q = query.trim(); if (q) { navigate(`/?ask=${encodeURIComponent(q)}`); setQuery(''); } }}>
                            <label className="relative block">
                                <span className="sr-only">{t('askPlaceholder')}</span>
                                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                                <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={500} placeholder={t('askPlaceholder')}
                                    className="h-11 w-full rounded-full border border-border bg-card pl-11 pr-4 text-caption text-foreground shadow-surface placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30" />
                            </label>
                        </form>

                        <div className="flex items-center gap-2">
                            <NotificationBell />
                            <div className="hidden items-center gap-2 lg:flex">
                                <span className="ml-1 flex items-center gap-2.5 pr-1">
                                    {user?.avatar_url
                                        ? <img src={user.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                                        : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-caption font-semibold text-primary">{user?.name?.charAt(0) || 'U'}</span>}
                                    <span className="text-caption font-semibold text-foreground">{user?.name}</span>
                                </span>
                                <Button
                                    variant="secondary"
                                    size="icon"
                                    onClick={toggleTheme}
                                    aria-label={t('user.toggleTheme')}
                                >
                                    {actualTheme === 'dark' ? (
                                        <Sun className="h-4 w-4" />
                                    ) : (
                                        <Moon className="h-4 w-4" />
                                    )}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={logout}
                                    aria-label={t('user.logout')}
                                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                >
                                    <LogOut className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </div>
                </header>

                <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1560px] px-4 pb-28 pt-6 lg:px-8 lg:pb-10 lg:pt-8">
                    {isOffline && (
                        <div className="mb-4 flex items-start gap-2 rounded-card border border-warning/40 bg-[rgb(var(--warning-soft))] px-4 py-2.5 text-caption text-warning">
                            <WifiOff className="mt-0.5 h-4 w-4 flex-shrink-0" />
                            <div>
                                <p>{t('offline')}</p>
                                {pendingWrites > 0 && (
                                    <p className="mt-1 font-medium">
                                        {t('offlineQueue.pending', { count: pendingWrites })}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                    {!isOffline && pendingWrites > 0 && (
                        <div className="mb-4 flex items-center gap-2 rounded-card border border-border bg-surface-2 px-4 py-2 text-caption text-muted-foreground">
                            <RefreshCw className="h-4 w-4 flex-shrink-0 animate-spin" />
                            {t('offlineQueue.syncing')}
                        </div>
                    )}
                    {children}
                </main>
            </div>

            <button
                type="button"
                onClick={() => {
                    setSidebarOpen(false);
                    setQuickActionsOpen((open) => !open);
                }}
                className="fixed bottom-24 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-surface-hover transition-all duration-fast ease-soft hover:bg-primary-hover active:scale-[0.98] lg:hidden"
                aria-label={t('quickActions.title')}
            >
                <Plus className="h-6 w-6" />
            </button>

            <div
                className={cn(
                    'fixed inset-x-4 bottom-44 z-50 rounded-card border border-border bg-card p-4 shadow-surface-hover',
                    'transition-all duration-base ease-soft lg:hidden',
                    quickActionsOpen
                        ? 'pointer-events-auto translate-y-0 opacity-100'
                        : 'pointer-events-none translate-y-3 opacity-0'
                )}
            >
                <p className="mb-3 text-caption font-semibold text-foreground">{t('quickActions.title')}</p>
                <div className="grid grid-cols-1 gap-2">
                    {quickActions.map((action) => {
                        const Icon = action.icon;
                        return (
                            <Link
                                key={action.labelKey}
                                to={action.href}
                                onClick={closeMenus}
                                className="flex items-center gap-2 rounded-input px-3 py-2 text-caption text-foreground hover:bg-surface-2"
                            >
                                <Icon className="h-4 w-4 text-primary" />
                                <span>{t(action.labelKey)}</span>
                            </Link>
                        );
                    })}
                </div>
            </div>

            <nav aria-label={t('mobileNav')} className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-safe backdrop-blur lg:hidden">
                <div className="grid grid-cols-5 gap-1 px-2 py-2">
                    {mobileTabs.map((item) => {
                        const Icon = item.icon;
                        const active = isRouteActive(location.pathname, item.href);
                        return (
                            <Link
                                key={item.labelKey}
                                to={item.href}
                                className={cn(
                                    'flex flex-col items-center justify-center gap-1 rounded-input px-1 py-2',
                                    active
                                        ? 'bg-primary-soft text-primary'
                                        : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'
                                )}
                            >
                                <Icon className="h-4 w-4 shrink-0" />
                                <span className="text-[10px] font-medium leading-none whitespace-nowrap">{t(item.labelKey)}</span>
                            </Link>
                        );
                    })}
                </div>
            </nav>
        </div>
    );
};

export default Layout;
