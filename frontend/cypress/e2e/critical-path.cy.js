/**
 * End-to-end coverage of the critical user journeys.
 *
 *   npx cypress run          headless
 *   npx cypress open         interactive
 *
 * Set the base URL in cypress.config.js, or pass it:
 *   npx cypress run --config baseUrl=https://d1ehv91jl1r1f2.cloudfront.net
 */

const USERS = {
  admin: { email: 'admin@acme.com', password: 'Admin@123' },
  manager: { email: 'manager@acme.com', password: 'Manager@123' },
  contributor: { email: 'dev@acme.com', password: 'Contrib@123' },
  viewer: { email: 'viewer@acme.com', password: 'Viewer@123' },
};

function login({ email, password }) {
  cy.visit('/login');
  cy.get('[data-testid="email"]').clear().type(email);
  cy.get('[data-testid="password"]').clear().type(password);
  cy.get('[data-testid="submit"]').click();
  cy.url().should('not.include', '/login');
}

describe('Authentication', () => {
  it('rejects bad credentials with a visible message', () => {
    cy.visit('/login');
    cy.get('[data-testid="email"]').type('admin@acme.com');
    cy.get('[data-testid="password"]').type('WrongPassword');
    cy.get('[data-testid="submit"]').click();
    cy.get('[role="alert"]').should('be.visible');
    cy.url().should('include', '/login');
  });

  it('gives the same message for an unknown email', () => {
    cy.visit('/login');
    cy.get('[data-testid="email"]').type('nobody@acme.com');
    cy.get('[data-testid="password"]').type('Admin@123');
    cy.get('[data-testid="submit"]').click();
    cy.get('[role="alert"]').should('contain.text', 'Invalid email or password');
  });

  it('blocks submission when fields are empty', () => {
    cy.visit('/login');
    cy.get('[data-testid="submit"]').click();
    cy.contains(/required/i).should('be.visible');
    cy.url().should('include', '/login');
  });

  it('toggles password visibility', () => {
    cy.visit('/login');
    cy.get('[data-testid="password"]').type('Admin@123')
      .should('have.attr', 'type', 'password');
    cy.get('[data-testid="toggle-password"]').click();
    cy.get('[data-testid="password"]').should('have.attr', 'type', 'text');
    cy.get('[data-testid="toggle-password"]').click();
    cy.get('[data-testid="password"]').should('have.attr', 'type', 'password');
  });

  it('logs in and lands on the dashboard', () => {
    login(USERS.admin);
    cy.get('[data-testid="summary-total-projects"]').should('be.visible');
  });

  it('redirects an unauthenticated visitor away from a protected page', () => {
    cy.visit('/projects');
    cy.url().should('include', '/login');
  });
});

describe('Self-registration', () => {
  it('rejects a non-company email address', () => {
    cy.visit('/login');
    cy.get('[data-testid="go-register"]').click();
    cy.get('[data-testid="full-name"]').type('Outsider');
    cy.get('[data-testid="email"]').type('someone@gmail.com');
    cy.get('[data-testid="password"]').type('Passw0rd1');
    cy.get('[data-testid="confirm-password"]').type('Passw0rd1');
    cy.get('[data-testid="submit"]').click();
    cy.contains(/acme\.com/i).should('be.visible');
  });

  it('requires matching passwords', () => {
    cy.visit('/login');
    cy.get('[data-testid="go-register"]').click();
    cy.get('[data-testid="full-name"]').type('Mismatch');
    cy.get('[data-testid="email"]').type(`m${Date.now()}@acme.com`);
    cy.get('[data-testid="password"]').type('Passw0rd1');
    cy.get('[data-testid="confirm-password"]').type('Different1');
    cy.get('[data-testid="submit"]').click();
    cy.contains(/do not match/i).should('be.visible');
  });

  it('creates a read-only account and signs in with it', () => {
    const email = `e2e${Date.now()}@acme.com`;

    cy.visit('/login');
    cy.get('[data-testid="go-register"]').click();
    cy.get('[data-testid="full-name"]').type('E2E Signup');
    cy.get('[data-testid="email"]').type(email);
    cy.get('[data-testid="password"]').type('Passw0rd1');
    cy.get('[data-testid="confirm-password"]').type('Passw0rd1');
    cy.get('[data-testid="submit"]').click();

    cy.contains(/read-only/i).should('be.visible');

    login({ email, password: 'Passw0rd1' });

    // Self-registration must never yield anything above viewer.
    cy.contains('VIEWER').should('be.visible');
    cy.visit('/projects');
    cy.get('[data-testid="new-project"]').should('not.exist');
  });
});

describe('Password recovery', () => {
  it('completes the reset cycle and invalidates the old password', () => {
    const email = `reset${Date.now()}@acme.com`;

    cy.visit('/login');
    cy.get('[data-testid="go-register"]').click();
    cy.get('[data-testid="full-name"]').type('Reset Tester');
    cy.get('[data-testid="email"]').type(email);
    cy.get('[data-testid="password"]').type('Original99');
    cy.get('[data-testid="confirm-password"]').type('Original99');
    cy.get('[data-testid="submit"]').click();

    cy.get('[data-testid="forgot-password"]').click();
    cy.get('[data-testid="email"]').type(email);
    cy.get('[data-testid="submit"]').click();

    // No mail service, so the token is shown and pre-filled.
    cy.get('[data-testid="reset-token"]').should('not.have.value', '');
    cy.get('[data-testid="password"]').type('BrandNew99');
    cy.get('[data-testid="confirm-password"]').type('BrandNew99');
    cy.get('[data-testid="submit"]').click();
    cy.contains(/password updated/i).should('be.visible');

    cy.get('[data-testid="email"]').clear().type(email);
    cy.get('[data-testid="password"]').clear().type('Original99');
    cy.get('[data-testid="submit"]').click();
    cy.get('[role="alert"]').should('be.visible');

    login({ email, password: 'BrandNew99' });
  });

  it('does not reveal whether an unknown account exists', () => {
    cy.visit('/login');
    cy.get('[data-testid="forgot-password"]').click();
    cy.get('[data-testid="email"]').type('nobody@acme.com');
    cy.get('[data-testid="submit"]').click();
    cy.get('[data-testid="reset-token"]').should('have.value', '');
  });
});

describe('Dashboard answers the business questions', () => {
  beforeEach(() => login(USERS.admin));

  it('shows at-risk projects with the reason', () => {
    cy.get('[data-testid="at-risk-table"]').should('exist').contains('ACM-102');
  });

  it('shows over-allocated people', () => {
    cy.get('[data-testid="over-allocated"]').contains('Lena Fischer');
  });

  it('shows budget consumption', () => {
    cy.get('[data-testid="budget-chart"]').should('be.visible');
  });
});

describe('Project CRUD', () => {
  it('creates, edits and deletes a project', () => {
    const code = `E2E-${Date.now().toString().slice(-5)}`;
    login(USERS.admin);
    cy.visit('/projects');

    cy.get('[data-testid="new-project"]').click();
    cy.get('[data-testid="project-code"]').type(code);
    cy.get('[data-testid="project-name"]').type('Cypress Test Project');
    cy.get('[data-testid="project-department"]').click();
    cy.get('[role="option"]').first().click();
    cy.get('[data-testid="project-manager"]').click();
    cy.get('[role="option"]').first().click();
    cy.get('[data-testid="project-start"]').type('01/01/2027');
    cy.get('[data-testid="project-end"]').type('30/06/2027');
    cy.get('[data-testid="save-project"]').click();

    cy.contains(code).should('be.visible');

    cy.get(`[data-testid="edit-${code}"]`).click();
    cy.get('[data-testid="project-name"]').clear().type('Cypress Renamed');
    cy.get('[data-testid="save-project"]').click();
    cy.contains('Cypress Renamed').should('be.visible');

    cy.get(`[data-testid="delete-${code}"]`).click();
    cy.get('[data-testid="confirm-delete"]').click();
    cy.contains(code).should('not.exist');
  });

  it('reports every missing field at once', () => {
    login(USERS.admin);
    cy.visit('/projects');
    cy.get('[data-testid="new-project"]').click();
    cy.get('[data-testid="save-project"]').click();
    cy.contains(/required/i).should('be.visible');
  });

  it('filters by search term', () => {
    login(USERS.admin);
    cy.visit('/projects');
    cy.get('[data-testid="project-search"]').type('Payments');
    cy.contains('ACM-102').should('be.visible');
    cy.contains('ACM-103').should('not.exist');
  });
});

describe('Role-based access control', () => {
  it('hides write actions from a viewer', () => {
    login(USERS.viewer);
    cy.visit('/projects');
    cy.get('[data-testid="new-project"]').should('not.exist');
    cy.get('[data-testid^="delete-"]').should('not.exist');
  });

  it('lets a contributor create but not delete', () => {
    login(USERS.contributor);
    cy.visit('/projects');
    cy.get('[data-testid="new-project"]').should('exist');
    cy.get('[data-testid^="delete-"]').should('not.exist');
  });

  it('shows Users only to an admin', () => {
    login(USERS.admin);
    cy.get('[data-testid="new-user"]').should('not.exist');
    cy.visit('/users');
    cy.get('[data-testid="new-user"]').should('exist');
  });

  it('bounces a manager away from the users route', () => {
    login(USERS.manager);
    cy.visit('/users');
    cy.url().should('not.include', '/users');
  });
});

describe('Dependency chains', () => {
  it('rejects a cycle with a readable message', () => {
    login(USERS.admin);
    cy.visit('/dependencies');
    cy.get('[data-testid="new-dependency"]').click();
    cy.get('[data-testid="dependency-predecessor"]').click();
    cy.get('[role="option"]').contains('Fraud rules migration').click();
    cy.get('[data-testid="dependency-successor"]').click();
    cy.get('[role="option"]').contains('Settlement API contract').click();
    cy.get('[data-testid="save-dependency"]').click();
    // The database trigger refuses; it must surface as a message, not a crash.
    cy.contains(/circular/i).should('be.visible');
  });
});

describe('Allocations', () => {
  it('permits over-allocation but warns about it', () => {
    login(USERS.admin);
    cy.visit('/people');
    cy.get('[data-testid="new-allocation"]').click();
    cy.get('[data-testid="allocation-person"]').click();
    cy.get('[role="option"]').contains('Lena Fischer').click();
    cy.get('[data-testid="allocation-project"]').click();
    cy.get('[role="option"]').first().click();
    cy.get('[data-testid="allocation-start"]').type('01/01/2027');
    cy.get('[data-testid="allocation-end"]').type('28/02/2027');
    cy.get('[data-testid="save-allocation"]').click();
    cy.get('.MuiAlert-root').should('be.visible');
  });
});

describe('Responsive layout', () => {
  it('switches to bottom navigation on a phone viewport', () => {
    cy.viewport('iphone-x');
    login(USERS.admin);
    cy.get('[data-testid="bottom-nav"]').should('be.visible');
    cy.get('[data-testid="side-drawer"]').should('not.exist');
  });
});
