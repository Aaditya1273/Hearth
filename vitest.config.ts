import { defineConfig } from 'vitest/config';

/**
 * Tests unitaires du depot, cote serveur et cote client.
 *
 * tests/client et tests/server ne touchent PAS la base : logique pure, celle
 * qui se casse en silence (fenetres de prise, recurrences, seuils,
 * traductions, regles Hearth). tests/integration demarre un PostgreSQL en
 * memoire (PGlite) et l'app Express reelle : aucun Docker requis. Le parcours
 * complet reste aussi couvert par scripts/smoke-api.sh.
 */
export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        environment: 'node',
        // Le fuseau des tests est fixe : les dates naives de l'app sont
        // interpretees en heure locale, un agent CI en UTC ne doit pas
        // changer le resultat.
        env: { TZ: 'Europe/Paris' },
        reporters: 'default',
        // Les tests d'integration demarrent un serveur PGlite : un fichier a la fois.
        fileParallelism: false,
        testTimeout: 30000,
        hookTimeout: 60000,
    },
});
