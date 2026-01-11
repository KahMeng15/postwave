# PostWave

Production-ready web application for scheduling Instagram posts with team collaboration and role-based access control. Built with Python Flask and vanilla JavaScript.

**📚 Full Documentation**: See [DOCUMENTATION.md](DOCUMENTATION.md) for complete setup guide, API reference, architecture, and troubleshooting.

## Features

- 🔐 Multi-user authentication with JWT
- 👥 **Team management with role-based access**
  - Owner: Full team control
  - Manager: Team management and post approval
  - Member: Create and schedule posts
  - Viewer: Read-only access
- 📱 Instagram Business API integration (per-team credentials)
- 📅 Automated post scheduling with background tasks
- ✅ **Post approval workflow** (optional per team member)
- 🖼️ Multi-image carousel posts (1-20 images)
- 👁️ Live Instagram preview before publishing
- 📊 Dashboard with post statistics
- 💌 **Email invitations** for team collaboration
- 🌙 Dark mode toggle
- 🎯 Drag & drop file upload
- ⌨️ Keyboard shortcuts (Ctrl/Cmd + N/D/P/S, ESC)
- 📱 Mobile responsive design
- 🖼️ Auto image optimization (resize to 1080px, compress to 8MB)
- 🐳 Docker deployment support
- 🔒 Production-ready security

## Quick Start

### Docker (Recommended)

```bash
# Set up environment
cp .env.example .env

# Edit .env with your Instagram API credentials
# Start the app
docker-compose up -d

# Open http://localhost:5000
```

### Local Development

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env

# Run the app
python app.py

# Open http://localhost:5500
```

## Setup & Configuration

### Prerequisites

- Python 3.11 or higher
- Docker (optional)
- Instagram Business Account
- Facebook Developer Account

### Environment Variables

Create a `.env` file in the root directory:

```env
# Flask Configuration
FLASK_ENV=production
SECRET_KEY=<generate-with: openssl rand -hex 32>
JWT_SECRET_KEY=<generate-with: openssl rand -hex 32>

# Database
DATABASE_URL=sqlite:///postwave.db

# Instagram API
INSTAGRAM_APP_ID=your-app-id
INSTAGRAM_APP_SECRET=your-app-secret
INSTAGRAM_API_VERSION=v19.0

# Email/SMTP Configuration (for team invitations)
MAIL_SERVER=smtp.gmail.com
MAIL_PORT=587
MAIL_USE_TLS=true
MAIL_USERNAME=your-email@gmail.com
MAIL_PASSWORD=your-app-password
MAIL_FROM_EMAIL=noreply@postwave.com
MAIL_FROM_NAME=PostWave

# Server
HOST=0.0.0.0
PORT=5500

# File Upload
MAX_CONTENT_LENGTH=52428800  # 50MB
UPLOAD_FOLDER=uploads
```

### Generate Secure Keys

```bash
# macOS/Linux
openssl rand -hex 32

# Or use Python
python3 -c "import secrets; print(secrets.token_hex(32))"
```

## Instagram Connection Setup

### Prerequisites

1. **Instagram Business or Creator Account**
   - Go to Instagram Settings → Account → Switch to Professional Account

2. **Facebook App with Instagram API Access**
   - Instagram Basic Display and Instagram Content Publishing permissions required

### Connection Methods

#### Method 1: Using Instagram Business Account ID (Recommended)

1. Get access token from [Facebook Graph API Explorer](https://developers.facebook.com/tools/explorer/)
2. Request permissions: `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`
3. During authorization, note your Instagram Business Account ID (displayed below username)
4. In IG Scheduler Settings, enter:
   - Access Token
   - Instagram Business Account ID
5. Click "Save & Connect"

#### Method 2: Using Facebook Page ID

1. Get your Facebook Page ID from your Facebook page
2. In IG Scheduler Settings, enter:
   - Access Token
   - Facebook Page ID
3. Click "Save & Connect"

### Troubleshooting

**"No Instagram Business Account found"**: Use Method 1 with Instagram Business Account ID

**"Access token has expired"**: Generate a new access token from Graph API Explorer. App will auto-convert short-lived tokens to long-lived tokens (~60 days)

## First-Time Setup

On first launch, PostWave displays an interactive 4-step onboarding wizard:

### Step 1: Super Admin Registration
Create your super admin account (the master administrator for the entire PostWave instance)
- Username
- Email  
- Password

### Step 2: SMTP Configuration (Optional)
Configure email settings for sending team member invitations:
- Mail Server (e.g., `smtp.gmail.com`)
- Port (e.g., `587`)
- Use TLS (recommended for Gmail)
- Email credentials
- From email and name

**Skip option**: Can configure email later in Settings → Email Configuration

### Step 3: Application URL (Optional)
Set your application's public URL used in email invitation links:
- Full URL including protocol (e.g., `https://postwave.your-domain.com`)

**Skip option**: Defaults to `http://localhost:5500` for local development

### Step 4: Create First Team
Create your initial team for managing Instagram accounts:
- Team Name
- Team Description (optional)

After setup completes, you'll be logged in and can:
- Access the dashboard
- Create additional teams
- Invite team members

### Account Access Model

**PostWave uses invite-only accounts:**
- No public registration available
- All accounts created via team invitations (after first setup)
- Super admin creates teams and invites members
- Members join via email invitation link
- Settings and configurations managed by super admin in Settings page

### Team Roles & Permissions

**Super Admin**
- Create and manage teams
- View and control all teams
- Edit, approve, or reject posts from any team
- Manage all users and settings
- Configure email and application settings

**Team Leader**
- Manage assigned teams
- Manage team members (invite, remove, set permissions)
- Configure team's Instagram API credentials
- Approve or reject member posts
- Create and schedule posts

**Team Member**
- Create draft posts
- Schedule posts (if enabled)
- View team posts
- Submit posts for approval (if required)

### Email Configuration

For team member invitations to work, configure your SMTP server in Settings → Email Configuration:

```env
# Gmail Example
MAIL_SERVER=smtp.gmail.com
MAIL_PORT=587
MAIL_USE_TLS=true
MAIL_USERNAME=your-email@gmail.com
MAIL_PASSWORD=your-app-password  # Use App Password for Gmail
MAIL_FROM_EMAIL=noreply@postwave.com
MAIL_FROM_NAME=PostWave
```

**Gmail Setup:**
1. Enable 2-Factor Authentication
2. Generate App Password: https://myaccount.google.com/apppasswords
3. Use the 16-character app password in `MAIL_PASSWORD`

3. Use the 16-character app password in `MAIL_PASSWORD`

### Application Settings

Instead of editing `.env` files, super admins can manage all email and server settings directly from the dashboard:

1. **Access Settings:**
   - Click your username in the top-right corner
   - Select "Settings"

2. **Available Settings:**
   - **Email Configuration** - SMTP server, port, TLS, credentials, from address
   - **Server Configuration** - Public URL for media access

3. **Features:**
   - Settings are stored in the database
   - Environment variables are used as fallback for initialization
   - Settings changes take effect immediately
   - Reset to environment values if needed

4. **Security:**
   - Only super admins can access settings
   - Password fields are masked in the UI
   - Database encryption recommended for production

## Using the App

### Creating a Post
1. Click "New Post" or press `Ctrl/Cmd + N`
2. Drag & drop or select images (up to 10)
3. Write caption (2200 chars max)
4. Choose schedule time
5. Preview and click "Schedule Post"

### Keyboard Shortcuts
- `Ctrl/Cmd + N` - New Post
- `Ctrl/Cmd + D` - Dashboard
- `Ctrl/Cmd + P` - All Posts
- `Ctrl/Cmd + S` - Settings
- `ESC` - Close Modal

## Project Structure

```
igscheduler/
├── app.py                    # Main Flask application
├── config.py                 # Configuration settings
├── models.py                 # Database models
├── db_manager.py             # Database utilities
├── instagram_api.py          # Instagram API wrapper
├── requirements.txt          # Python dependencies
├── docker-compose.yml        # Docker configuration
├── Dockerfile                # Docker image definition
├── .env.example              # Example environment file
├── static/
│   ├── index.html           # Single-page app
│   ├── css/style.css        # Styling (dark mode, responsive)
│   └── js/app.js            # Frontend logic
├── routes/
│   ├── auth.py              # Authentication endpoints
│   ├── posts.py             # Post management endpoints
│   ├── instagram.py         # Instagram API endpoints
│   └── users.py             # User management endpoints
├── uploads/                 # Media storage
└── instance/
    └── scheduler.db         # SQLite database (dev)
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login and get JWT token
- `POST /api/auth/refresh` - Refresh access token
- `GET /api/auth/me` - Get current user info

### Teams
- `POST /api/teams/setup-admin` - Initialize first super admin
- `GET /api/teams/teams` - List user's teams
- `POST /api/teams/teams` - Create new team
- `GET /api/teams/teams/<id>` - Get team details
- `PUT /api/teams/teams/<id>` - Update team
- `GET /api/teams/teams/<id>/members` - List team members
- `PUT /api/teams/teams/<id>/members/<uid>` - Update member permissions
- `DELETE /api/teams/teams/<id>/members/<uid>` - Remove team member
- `POST /api/teams/invite` - Invite user to team
- `POST /api/teams/accept-invite/<token>` - Accept invitation

### Posts
- `GET /api/posts` - List user posts
- `POST /api/posts` - Create new post
- `GET /api/posts/<id>` - Get post details
- `PUT /api/posts/<id>` - Update post
- `DELETE /api/posts/<id>` - Delete post
- `GET /api/posts-approval/team/<id>/posts` - List team posts
- `POST /api/posts-approval/posts/<id>/send-approval` - Send for approval
- `POST /api/posts-approval/posts/<id>/approve` - Approve post (leader only)
- `POST /api/posts-approval/posts/<id>/reject` - Reject post (leader only)

### Instagram Connection
- `POST /api/instagram/connect` - Connect team's Instagram account
- `POST /api/instagram/fetch-profile-picture` - Cache profile picture
- `GET /api/instagram/media` - Get team's media list

### Users
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update user profile

## Deployment

### Production Deployment

1. Set `FLASK_ENV=production` in `.env`
2. Use a production WSGI server (Gunicorn, uWSGI)
3. Set up reverse proxy (Nginx, Apache)
4. Enable HTTPS
5. Configure database (PostgreSQL recommended for production)

### Docker Deployment

```bash
# Build and run with Docker
docker-compose up -d

# View logs
docker-compose logs -f

# Stop application
docker-compose down
```

### Environment Variables for Production

```env
FLASK_ENV=production
DATABASE_URL=postgresql://user:password@host:5432/igscheduler
SECRET_KEY=<very-long-random-string>
JWT_SECRET_KEY=<very-long-random-string>
```

## Database

### Backup & Maintenance

For SQLite (development):
```bash
# Backup database
cp instance/scheduler.db backups/scheduler.db.backup
```

For PostgreSQL (production):
```bash
pg_dump dbname > backup.sql
```

## Troubleshooting

### App won't start
```bash
# Check Python version (need 3.11+)
python3 --version

# Reinstall dependencies
pip install -r requirements.txt --force-reinstall

# Check ports (5000 should be free)
lsof -i :5000  # Mac/Linux
netstat -ano | findstr :5000  # Windows
```

### Instagram posting fails
- Verify Instagram Business Account
- Check Facebook Page is linked to Instagram
- Ensure Access Token is valid (they expire!)
- Confirm Media URLs are publicly accessible
- Check Instagram API rate limits

### Images not uploading
- Max 20 images per post
- Supported: JPG, PNG, GIF
- Auto-optimized to 1080px max, 8MB limit
- Check `uploads/` folder permissions

### Docker issues
```bash
# Rebuild completely
docker-compose down -v
docker-compose up -d --build

# Check logs
docker-compose logs -f

# Check container status
docker-compose ps
```

## Tech Stack

- **Backend:** Flask 3.0, SQLAlchemy, APScheduler
- **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3
- **Database:** SQLite (dev), PostgreSQL (production)
- **APIs:** Instagram Graph API, Facebook Pages API
- **Deployment:** Docker, Docker Compose

## Security

- JWT token authentication
- Bcrypt password hashing
- CORS protection
- SQL injection prevention (SQLAlchemy ORM)
- File upload validation
- Rate limiting on APIs
- HTTPS support via reverse proxy

## API Limits

**Instagram Graph API:**
- 25 API calls per user per 24 hours
- 200 API calls per app per hour
- Media must be publicly accessible URLs
- Carousels: 2-10 items

**App Limits:**
- Max 20 images per post
- Caption: 2200 characters
- Image size: Auto-optimized to 8MB, 1080px

## Changelog

### v2.0 (January 2026)
- **Team Management System**
  - Multi-team support with separate Instagram API credentials per team
  - Role-based access control (Super Admin, Team Leader, Team Member)
  - Email-based team invitations with 7-day expiration
  - Team member permission management
- **Post Approval Workflow**
  - Optional post approval requirement per team member
  - Team leader approval/rejection interface
  - Post history tracking
- **Email Integration**
  - SMTP-based email invitations
  - Configurable email settings
- **Profile Picture Caching**
  - Instagram profile pictures cached locally
  - Auto-refresh on profile updates

### v1.1 (December 2024)
- Added dark mode with persistent preference
- Drag & drop file upload
- Keyboard navigation shortcuts
- Enhanced mobile responsiveness
- Auto image optimization (resize/compress)
- CSS compatibility improvements

### v1.0 (December 2024)
- Initial release
- Multi-user authentication
- Instagram API integration
- Post scheduling
- Multi-image carousel support
- Dashboard with statistics

## License

MIT License - use freely for personal or commercial projects.

## Support

For issues, feature requests, or questions, please open an issue on GitHub or refer to the troubleshooting section above.

## Credits

Built with ❤️ for Instagram content creators.
