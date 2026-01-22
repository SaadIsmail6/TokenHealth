# Deployment Guide for TokenHealth Bot

This guide will help you deploy your TokenHealth bot to a hosting platform.

## Required Environment Variables

Before deploying, make sure you have:
- `APP_PRIVATE_DATA` - Your Towns app private data (base64 encoded)
- `JWT_SECRET` - JWT secret for webhook authentication
- `PORT` - Port to run the bot on (optional, defaults to 5123)

## Option 1: Deploy to Railway (Recommended)

Railway is a popular platform that makes deployment easy.

### Steps:

1. **Sign up/Login to Railway**
   - Go to https://railway.app
   - Sign up with GitHub

2. **Create a New Project**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your `TokenHealth` repository

3. **Configure Environment Variables**
   - Go to your project settings
   - Click "Variables" tab
   - Add these variables:
     - `APP_PRIVATE_DATA` = (your base64 encoded app private data)
     - `JWT_SECRET` = (your JWT secret)
     - `PORT` = `5123` (or leave default)

4. **Deploy**
   - Railway will automatically detect the project and deploy
   - The bot will be available at: `https://your-app-name.up.railway.app`

5. **Get Your Webhook URL**
   - Copy the deployment URL from Railway
   - Your webhook URL will be: `https://your-app-name.up.railway.app`
   - Use this URL when configuring your bot in Towns

## Option 2: Deploy to Render

Render offers a free tier for web services.

### Steps:

1. **Sign up/Login to Render**
   - Go to https://render.com
   - Sign up with GitHub

2. **Create a New Web Service**
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Select the `TokenHealth` repository

3. **Configure Build Settings**
   - **Build Command**: `cd TokenHealth && bun install`
   - **Start Command**: `cd TokenHealth && bun run start`
   - **Environment**: `Node`

4. **Add Environment Variables**
   - Scroll to "Environment Variables"
   - Add:
     - `APP_PRIVATE_DATA` = (your base64 encoded app private data)
     - `JWT_SECRET` = (your JWT secret)
     - `PORT` = `5123`

5. **Deploy**
   - Click "Create Web Service"
   - Render will build and deploy your bot
   - Your bot will be available at: `https://your-app-name.onrender.com`

## Option 3: Deploy to Fly.io

Fly.io is great for edge deployments.

### Steps:

1. **Install Fly CLI**
   ```bash
   powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
   ```

2. **Login to Fly**
   ```bash
   fly auth login
   ```

3. **Create a Fly App**
   ```bash
   cd TokenHealth
   fly launch
   ```

4. **Set Environment Variables**
   ```bash
   fly secrets set APP_PRIVATE_DATA="your-value"
   fly secrets set JWT_SECRET="your-value"
   fly secrets set PORT="5123"
   ```

5. **Deploy**
   ```bash
   fly deploy
   ```

## After Deployment

1. **Get your deployment URL**
   - Copy the URL from your hosting platform
   - Example: `https://tokenhealth.up.railway.app`

2. **Configure in Towns**
   - Go to your Towns bot settings
   - Set the webhook URL to your deployment URL
   - The bot will automatically receive events at: `https://your-url/webhook`

3. **Test the Bot**
   - The discovery endpoint should be available at:
     `https://your-url/.well-known/agent-metadata.json`
   - Test your bot commands in Towns

## Troubleshooting

- **Bot not responding?** Check that:
  - Environment variables are set correctly
  - The webhook URL is configured in Towns
  - The bot is deployed and running (check logs)

- **Port issues?** Make sure:
  - `PORT` environment variable is set
  - Your hosting platform exposes the port correctly

- **Build failures?** Ensure:
  - All dependencies are in `package.json`
  - The build command runs successfully locally first

## Need Help?

Check the Towns Protocol documentation: https://docs.towns.com

