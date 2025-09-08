#!/bin/bash
# Script to set up test environment and credentials for RMIT Store CI/CD

echo "=== RMIT Store CI/CD Setup Helper ==="

# Default credentials (should be changed in production)
DEFAULT_ADMIN_EMAIL="admin@rmit.edu.vn"
DEFAULT_ADMIN_PASSWORD="admin123456"

echo ""
echo "This script helps set up the environment for running E2E tests."
echo "It can be used to configure Jenkins credentials or set local test variables."
echo ""

echo "Recommended Jenkins credentials to configure:"
echo "1. Create a credential with ID: 'seed-admin'"
echo "   - Type: Username with password"
echo "   - Username: ${DEFAULT_ADMIN_EMAIL}"
echo "   - Password: ${DEFAULT_ADMIN_PASSWORD}"
echo ""

echo "Environment variables for local testing:"
echo "export E2E_EMAIL=\"${DEFAULT_ADMIN_EMAIL}\""
echo "export E2E_PASSWORD=\"${DEFAULT_ADMIN_PASSWORD}\""
echo "export SEED_ADMIN_EMAIL=\"${DEFAULT_ADMIN_EMAIL}\""
echo "export SEED_ADMIN_PASSWORD=\"${DEFAULT_ADMIN_PASSWORD}\""
echo ""

echo "To run E2E tests locally:"
echo "1. Start your application (frontend and backend)"
echo "2. Set the E2E_BASE_URL environment variable:"
echo "   export E2E_BASE_URL=\"http://localhost:8080\""
echo "3. Run the tests:"
echo "   npx playwright test"
echo ""

echo "Note: Update these credentials in production environments!"
echo "The default password should be changed to something more secure."
