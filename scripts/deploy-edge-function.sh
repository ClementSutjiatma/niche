#!/bin/bash
# Deploy niche-api Edge Function to Supabase

set -e

PROJECT_REF="uqedheymwswlbblximuq"
FUNCTION_NAME="niche-api"

# Check if SUPABASE_ACCESS_TOKEN is set
if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
    echo "❌ Error: SUPABASE_ACCESS_TOKEN environment variable is not set"
    echo ""
    echo "Please set your Supabase access token:"
    echo "  export SUPABASE_ACCESS_TOKEN=your_token_here"
    echo ""
    echo "Get your token from: https://supabase.com/dashboard/account/tokens"
    exit 1
fi

echo "🚀 Deploying $FUNCTION_NAME to Supabase..."
echo "   Project: $PROJECT_REF"
echo ""

# Deploy the function
npx supabase functions deploy "$FUNCTION_NAME" \
    --project-ref "$PROJECT_REF" \
    --no-verify-jwt

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Deployment successful!"
    echo ""
    echo "📡 Function URL:"
    echo "   https://$PROJECT_REF.supabase.co/functions/v1/$FUNCTION_NAME"
    echo ""
    echo "🧪 Test the new escrow routes:"
    echo "   curl https://$PROJECT_REF.supabase.co/functions/v1/$FUNCTION_NAME/escrow/5cb4e881-9fba-416a-8307-cca64dcf1d42"
else
    echo ""
    echo "❌ Deployment failed!"
    echo "Check the error message above for details."
    exit 1
fi
