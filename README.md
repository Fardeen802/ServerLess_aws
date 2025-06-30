# Serverless Chat Application

A production-ready serverless chat application built with AWS Lambda, API Gateway, MongoDB, and OpenAI integration. Each browser tab/session creates a new independent chat session.

## 🚀 Features

- **Session-based Chat**: Each tab creates a new session with unique `sessionId`
- **OpenAI Integration**: Powered by GPT-3.5-turbo for intelligent responses
- **MongoDB Storage**: Persistent conversation history per session
- **Rate Limiting**: Built-in rate limiting (10 requests per minute per session)
- **Caching**: In-memory session caching for improved performance
- **Production Ready**: Optimized for AWS Lambda deployment with monitoring
- **Auto-cleanup**: TTL index automatically removes old conversations (30 days)
- **Health Monitoring**: Built-in health check endpoint
- **Structured Logging**: Winston-based logging with different levels
- **AWS X-Ray**: Distributed tracing for performance monitoring
- **Security**: Input validation, CORS, and rate limiting

## 🏗️ Architecture

```
Frontend → API Gateway → Lambda → MongoDB
                    ↓
                OpenAI API
                    ↓
                CloudWatch Logs
                    ↓
                AWS X-Ray
```

## 📋 Prerequisites

- Node.js 18.x or higher
- AWS CLI configured with appropriate permissions
- MongoDB instance (local or cloud)
- OpenAI API key
- AWS account with Lambda, API Gateway, and CloudWatch access

## 🔧 Environment Setup

### Quick Setup

```bash
# Create environment files for development and production
npm run setup:dev
npm run setup:prod
```

This creates:
- `.env.dev` - Development environment variables
- `.env.prod` - Production environment variables

### Required Environment Variables

Edit your `.env.dev` and `.env.prod` files with your actual values:

```bash
# Required Environment Variables
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/chat-app
OPENAI_API_KEY=your-openai-api-key-here

# Optional Environment Variables
NODE_ENV=production
LOG_LEVEL=info
STAGE=prod

# AWS VPC Configuration (optional)
VPC_SECURITY_GROUP_ID=sg-00000000000000000
VPC_SUBNET_ID_1=subnet-00000000000000000
VPC_SUBNET_ID_2=subnet-00000000000000000

# Rate Limiting
RESERVED_CONCURRENCY=100

# CORS Configuration
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Application Configuration
OWNER=dev-team
```

## 🛠️ Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Edit environment file:**
   ```bash
   # Edit .env.dev with your values
   nano .env.dev
   ```

3. **Start local development server:**
   ```bash
   npm run dev
   ```

   The server will start at `http://localhost:3000`

## 📡 API Usage

### Chat Endpoint

**POST** `/chat`

**Request Body:**
```json
{
  "sessionId": "unique-session-id",
  "message": "Hello, how are you?"
}
```

**Response:**
```json
{
  "reply": "Hello! I'm doing well, thank you for asking. How can I help you today?",
  "sessionId": "unique-session-id",
  "responseTime": 1250,
  "tokens": 45
}
```

### Health Check Endpoint

**GET** `/health`

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 3600,
  "responseTime": "15ms",
  "version": "1.0.0",
  "environment": {
    "node_env": "production",
    "stage": "prod"
  },
  "services": {
    "database": {
      "status": "healthy",
      "timestamp": "2024-01-01T00:00:00.000Z"
    },
    "environment": {
      "mongodb_uri": true,
      "openai_api_key": true,
      "node_env": "production",
      "stage": "prod"
    }
  },
  "memory": {
    "used": 45,
    "total": 1024,
    "external": 12
  }
}
```

### Example Usage

```bash
# Send a message
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "session-123",
    "message": "What is the capital of France?"
  }'

# Check health
curl http://localhost:3000/health
```

## 🚀 Production Deployment

### Quick Deployment

```bash
# Deploy to production (uses .env.prod file)
./scripts/deploy.sh prod us-east-1
```

### Manual Deployment

1. **Configure AWS Credentials:**
   ```bash
   aws configure
   ```

2. **Edit production environment file:**
   ```bash
   # Edit .env.prod with your production values
   nano .env.prod
   ```

3. **Deploy to AWS:**
   ```bash
   # Deploy to dev stage
   npm run deploy

   # Deploy to production
   npm run deploy:prod
   ```

4. **Get API Endpoint:**
   After deployment, you'll get an API Gateway endpoint like:
   ```
   https://abc123.execute-api.us-east-1.amazonaws.com/prod/chat
   ```

## 🔒 Production Security

### Database Security
- Use MongoDB Atlas with network access restrictions
- Enable authentication and authorization
- Use connection string with username/password
- Enable SSL/TLS encryption

### AWS Security
- Use VPC for Lambda functions (optional)
- Configure security groups properly
- Use IAM roles with minimal permissions
- Enable CloudTrail for audit logging

### Application Security
- Input validation and sanitization
- Rate limiting per session
- CORS configuration
- Environment variable protection
- Request/response logging

## 📊 Monitoring & Observability

### CloudWatch Logs
```bash
# View logs
npm run logs

# View production logs
npm run logs:prod

# Follow logs in real-time
npm run logs -t
```

### AWS X-Ray
- Distributed tracing enabled
- Performance monitoring
- Service map visualization
- Error tracking

### Health Monitoring
- Built-in health check endpoint
- Database connectivity monitoring
- Environment variable validation
- Memory usage tracking

## 🔧 Configuration

### MongoDB Setup

1. **MongoDB Atlas** (Recommended for production):
   - Create a cluster
   - Set up network access (0.0.0.0/0 for Lambda)
   - Create a database user
   - Get connection string

2. **Local MongoDB** (Development only):
   ```bash
   docker run -d -p 27017:27017 --name mongodb mongo:latest
   ```

### Performance Optimizations

- **Connection Pooling**: MongoDB connection is cached
- **Session Caching**: Recent conversations cached in memory
- **Rate Limiting**: Prevents abuse (10 requests/minute per session)
- **TTL Index**: Automatic cleanup of old data (30 days)
- **Message Limits**: Max 4000 characters per message
- **History Limits**: Last 50 messages per session
- **Lambda Memory**: 1024MB for optimal performance
- **Reserved Concurrency**: Configurable concurrency limits

## 🚨 Error Handling

The application handles various error scenarios:

- **400**: Invalid input (missing sessionId/message, invalid JSON)
- **405**: Wrong HTTP method
- **408**: OpenAI API timeout
- **429**: Rate limit exceeded
- **500**: Internal server error
- **503**: Service unavailable (database issues)

## 💰 Cost Optimization

- **Lambda**: 1024MB memory, 30s timeout, reserved concurrency
- **MongoDB**: TTL index removes old data automatically
- **OpenAI**: Token limits and caching
- **API Gateway**: Pay per request
- **CloudWatch**: Log retention set to 14 days

## 🛠️ Development Tools

### Code Quality
```bash
# Lint code
npm run lint

# Format code
npm run format

# Security audit
npm run security-check
```

### Testing
```bash
# Run tests (if configured)
npm run test
```

## 🔍 Troubleshooting

### Common Issues

1. **MongoDB Connection Failed**
   - Check connection string in `.env.prod`
   - Verify network access
   - Check authentication
   - Review security group settings

2. **OpenAI API Errors**
   - Verify API key in `.env.prod`
   - Check quota/rate limits
   - Ensure proper billing
   - Review API usage

3. **Lambda Timeout**
   - Increase timeout in serverless.yml
   - Check MongoDB performance
   - Monitor OpenAI response times
   - Review cold start performance

4. **High Memory Usage**
   - Monitor memory usage in CloudWatch
   - Optimize code for memory efficiency
   - Consider increasing Lambda memory

### Debug Commands

```bash
# Package without deploying
npm run package

# Remove deployment
npm run remove

# Remove production deployment
npm run remove:prod

# View function logs
npm run logs

# Check health endpoint
curl https://your-api-gateway-url/prod/health
```

## 🌐 Frontend Integration

Each browser tab should generate a unique `sessionId`:

```javascript
// Generate session ID for each tab
const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Send message
const response = await fetch('/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId, message: 'Hello' })
});

const data = await response.json();
console.log(data.reply);
```

## 📈 Scaling Considerations

- **Horizontal Scaling**: Lambda automatically scales based on demand
- **Database Scaling**: MongoDB Atlas provides automatic scaling
- **Caching**: In-memory session caching reduces database load
- **Rate Limiting**: Prevents resource exhaustion
- **Monitoring**: CloudWatch and X-Ray for performance insights

## 🔄 CI/CD Integration

### GitHub Actions Example
```yaml
name: Deploy to Production
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run lint
      - run: npm run security-check
      - run: ./scripts/deploy.sh prod us-east-1
        env:
          MONGODB_URI: ${{ secrets.MONGODB_URI }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

## 📄 License

ISC

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## 📞 Support

For issues and questions:
- Check the troubleshooting section
- Review CloudWatch logs
- Monitor health endpoint
- Check AWS X-Ray traces 