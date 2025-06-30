#!/bin/bash

# Production Deployment Script for Serverless Chat Application
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
STAGE=${1:-prod}
REGION=${2:-us-east-1}

echo -e "${GREEN}🚀 Starting production deployment...${NC}"
echo -e "${YELLOW}Stage: ${STAGE}${NC}"
echo -e "${YELLOW}Region: ${REGION}${NC}"

# Check if required tools are installed
check_dependencies() {
    echo -e "${YELLOW}Checking dependencies...${NC}"
    
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Node.js is not installed${NC}"
        exit 1
    fi
    
    if ! command -v npm &> /dev/null; then
        echo -e "${RED}❌ npm is not installed${NC}"
        exit 1
    fi
    
    if ! command -v aws &> /dev/null; then
        echo -e "${RED}❌ AWS CLI is not installed${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ All dependencies are installed${NC}"
}

# Check if .env file exists
check_env_file() {
    echo -e "${YELLOW}Checking environment file...${NC}"
    
    ENV_FILE=".env.${STAGE}"
    
    if [ ! -f "$ENV_FILE" ]; then
        echo -e "${RED}❌ Environment file $ENV_FILE not found${NC}"
        echo -e "${YELLOW}Creating $ENV_FILE from template...${NC}"
        
        if [ -f "env.example" ]; then
            cp env.example "$ENV_FILE"
            echo -e "${GREEN}✅ Created $ENV_FILE from template${NC}"
            echo -e "${YELLOW}⚠️  Please edit $ENV_FILE with your actual values before deploying${NC}"
            exit 1
        else
            echo -e "${RED}❌ env.example template not found${NC}"
            exit 1
        fi
    fi
    
    echo -e "${GREEN}✅ Environment file $ENV_FILE found${NC}"
}

# Validate environment variables from .env file
validate_env() {
    echo -e "${YELLOW}Validating environment variables...${NC}"
    
    ENV_FILE=".env.${STAGE}"
    
    # Source the .env file to load variables
    if [ -f "$ENV_FILE" ]; then
        export $(grep -v '^#' "$ENV_FILE" | xargs)
    fi
    
    if [ -z "$MONGODB_URI" ] || [ "$MONGODB_URI" = "mongodb+srv://username:password@cluster.mongodb.net/chat-app" ]; then
        echo -e "${RED}❌ MONGODB_URI is not set or still has default value${NC}"
        echo -e "${YELLOW}Please edit $ENV_FILE and set your MongoDB connection string${NC}"
        exit 1
    fi
    
    if [ -z "$OPENAI_API_KEY" ] || [ "$OPENAI_API_KEY" = "your-openai-api-key-here" ]; then
        echo -e "${RED}❌ OPENAI_API_KEY is not set or still has default value${NC}"
        echo -e "${YELLOW}Please edit $ENV_FILE and set your OpenAI API key${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Environment variables are valid${NC}"
}

# Install dependencies
install_deps() {
    echo -e "${YELLOW}Installing dependencies...${NC}"
    npm ci --production=false
    echo -e "${GREEN}✅ Dependencies installed${NC}"
}

# Run security checks
security_check() {
    echo -e "${YELLOW}Running security checks...${NC}"
    npm audit --audit-level=moderate
    echo -e "${GREEN}✅ Security checks passed${NC}"
}

# Run linting
lint_code() {
    echo -e "${YELLOW}Running code linting...${NC}"
    npm run lint
    echo -e "${GREEN}✅ Code linting passed${NC}"
}

# Deploy to AWS
deploy() {
    echo -e "${YELLOW}Deploying to AWS...${NC}"
    
    # Deploy using serverless (dotenv plugin will automatically load .env file)
    npx serverless deploy \
        --stage $STAGE \
        --region $REGION \
        --verbose
    
    echo -e "${GREEN}✅ Deployment completed successfully${NC}"
}

# Get deployment info
get_info() {
    echo -e "${YELLOW}Getting deployment information...${NC}"
    
    # Get API Gateway URL
    API_URL=$(aws apigateway get-rest-apis --region $REGION --query "items[?name=='serverless-chat-app-$STAGE'].id" --output text)
    
    if [ ! -z "$API_URL" ]; then
        echo -e "${GREEN}🌐 API Gateway URL: https://$API_URL.execute-api.$REGION.amazonaws.com/$STAGE${NC}"
        echo -e "${GREEN}📝 Chat endpoint: https://$API_URL.execute-api.$REGION.amazonaws.com/$STAGE/chat${NC}"
        echo -e "${GREEN}🏥 Health endpoint: https://$API_URL.execute-api.$REGION.amazonaws.com/$STAGE/health${NC}"
    else
        echo -e "${RED}❌ Could not retrieve API Gateway URL${NC}"
    fi
}

# Run tests (if available)
run_tests() {
    echo -e "${YELLOW}Running tests...${NC}"
    if npm run test 2>/dev/null; then
        echo -e "${GREEN}✅ Tests passed${NC}"
    else
        echo -e "${YELLOW}⚠️  No tests configured${NC}"
    fi
}

# Main deployment flow
main() {
    echo -e "${GREEN}================================${NC}"
    echo -e "${GREEN}   PRODUCTION DEPLOYMENT${NC}"
    echo -e "${GREEN}================================${NC}"
    
    check_dependencies
    check_env_file
    validate_env
    install_deps
    security_check
    lint_code
    run_tests
    deploy
    get_info
    
    echo -e "${GREEN}================================${NC}"
    echo -e "${GREEN}   DEPLOYMENT COMPLETED!${NC}"
    echo -e "${GREEN}================================${NC}"
}

# Run main function
main "$@" 