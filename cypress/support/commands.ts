/// <reference types="cypress" />

import 'cypress-iframe';

// ***********************************************
// This example commands.ts shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************
//
//
// -- This is a parent command --
// Cypress.Commands.add('login', (email, password) => { ... })
//
//
// -- This is a child command --
// Cypress.Commands.add('drag', { prevSubject: 'element'}, (subject, options) => { ... })
//
//
// -- This is a dual command --
// Cypress.Commands.add('dismiss', { prevSubject: 'optional'}, (subject, options) => { ... })
//
//
// -- This will overwrite an existing command --
// Cypress.Commands.overwrite('visit', (originalFn, url, options) => { ... })
//
// declare global {
//   namespace Cypress {
//     interface Chainable {
//       login(email: string, password: string): Chainable<void>
//       drag(subject: string, options?: Partial<TypeOptions>): Chainable<Element>
//       dismiss(subject: string, options?: Partial<TypeOptions>): Chainable<Element>
//       visit(originalFn: CommandOriginalFn, url: string, options: Partial<VisitOptions>): Chainable<Element>
//     }
//   }
// }

type Flatten<T> = T extends Iterable<infer Item> ? Item : never;
type ArrayIterator<T, TResult> = (value: T, index: number, collection: T[]) => TResult;

declare global {
    namespace Cypress {
        interface Chainable<Subject> {
            map<Item extends Flatten<Subject>, K extends keyof Item>(iteratee: K): Chainable<Item[K][]>;
            map<Item extends Flatten<Subject>, TResult>(iteratee: ArrayIterator<Item, TResult>): Chainable<TResult[]>;
        }
    }
}

Cypress.Commands.add('map', { prevSubject: true }, (subject: unknown[], iteratee) => {
    return cy.wrap(
        Cypress._.map(subject, iteratee),
        { log: false }
    );
});

// The release launcher lives at `/`, while Lean4Game is served as a static
// sub-application. Preserve the existing local-development routes by default,
// but let live release runs redirect legacy `/#/...` visits to the configured
// Lean4Game entry document.
Cypress.Commands.overwrite('visit', (originalFn, url, options) => {
    const releaseEntry = Cypress.env('LEAN4GAME_ENTRY');
    let resolvedUrl = url;
    if (releaseEntry && typeof url === 'string') {
        if (url.startsWith('/#/')) {
            resolvedUrl = `${releaseEntry}${url.slice(1)}`;
        } else if (url.startsWith('/lean4game/index.html#/')) {
            resolvedUrl = `${releaseEntry}${url.slice('/lean4game/index.html'.length)}`;
        }
    }
    return originalFn(resolvedUrl, options);
});

Cypress.on('uncaught:exception', (err, runnable) => {
    // returning false here prevents Cypress from
    // failing the test
    return false;
});
