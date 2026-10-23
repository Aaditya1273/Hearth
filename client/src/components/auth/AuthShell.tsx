import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sun, Moon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { LanguageSwitcher } from '../ui/LanguageSwitcher';
import { useTheme } from '../../contexts/ThemeContext';
import { AuthHeroPanel } from '../app/HearthHero';

interface AuthShellProps {
    /** Sous-titre affiche sous le logo (par defaut : la tagline). */
    subtitle?: string;
    children: React.ReactNode;
}

/**
 * Coque commune des ecrans publics d'authentification (mot de passe oublie,
 * nouveau mot de passe) : meme presentation que la page de connexion.
 */
export const AuthShell: React.FC<AuthShellProps> = ({ subtitle, children }) => {
    const { t } = useTranslation(['auth', 'nav']);
    const { actualTheme, setTheme } = useTheme();

    return (
        <div className="min-h-screen bg-background lg:grid lg:grid-cols-[1.1fr_1fr]">
            <AuthHeroPanel />
            <div className="relative flex flex-col items-center justify-center p-4 pb-24 pt-20 lg:min-h-screen">
            <LanguageSwitcher className="absolute top-4 left-4" />
            <button
                type="button"
                onClick={() => setTheme(actualTheme === 'dark' ? 'light' : 'dark')}
                aria-label={t('nav:user.toggleTheme')}
                className="absolute top-4 right-4 p-2 rounded-input border border-border bg-card text-muted-foreground hover:text-foreground hover:border-border-strong transition-colors"
            >
                {actualTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <Card className="w-full max-w-md" hover={false}>
                <CardHeader className="text-center pb-8 pt-8">
                    <div className="mx-auto mb-6 hidden">
                        <img src={`${import.meta.env.BASE_URL}hearth-mark.svg`} alt="Hearth" className="w-16 h-16 rounded-xl object-contain mx-auto" />
                    </div>
                    <CardTitle className="font-display text-[32px] font-medium leading-tight mb-2">
                        Hearth
                    </CardTitle>
                    <p className="text-muted-foreground text-caption">{subtitle ?? t('auth:tagline')}</p>
                </CardHeader>
                <CardContent className="space-y-6 px-8 pb-8">{children}</CardContent>
            </Card>
            <p className="absolute bottom-6 left-0 w-full px-4 text-center text-label-sm text-muted-foreground">
                Hearth &middot; built on <a href="https://github.com/NexaFlowFrance/OpenCare" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">OpenCare</a> by NexaFlow (AGPL-3.0) &middot; {t('auth:footer')}
            </p>
            </div>
        </div>
    );
};
