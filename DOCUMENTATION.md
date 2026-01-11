# 📚 PostWave Documentation

Complete guide for PostWave - Instagram Post Scheduler with Invite-Only Access System.

---

## 📖 Table of Contents

1. [Quick Start](#quick-start)
2. [Project Overview](#project-overview)
3. [Installation & Setup](#installation--setup)
4. [System Architecture](#system-architecture)
5. [User Roles & Permissions](#user-roles--permissions)
6. [API Reference](#api-reference)
7. [Configuration](#configuration)
8. [Troubleshooting](#troubleshooting)

---

## Quick Start

### For New Users
1. Receive an invitation link from your team administrator
2. Click the link and accept the invitation
3. Create your account (new users) or login (existing users)
4. Complete the 4-step onboarding wizard
5. Start scheduling Instagram posts!

### For Administrators
1. Install PostWave (see [Installation](#installation--setup))
2. Configure email and domain settings (Settings → Admin Settings)
3. Create teams and invite members
4. Manage team roles and permissions
5. Monitor activity logs

### For Developers
1. Clone the repository
2. Follow [Local Development Setup](#local-setup)
3. Review [Architecture](#system-architecture)
4. Check [API Reference](#api-reference) for endpoints

---

## Project Overview

### What is PostWave?

PostWave is a Flask-based application for scheduling Instagram posts with an invite-only access system. It features:

- **Invite-Only Access**: Secure registration through team invitations
- **Team Management**: Create teams, manage members with granular roles
- **Role-Based Permissions**: Owner, Manager, Member, and Viewer roles
- **Instagram Integration**: Connect Instagram accounts and schedule posts
- **Activity Logging**: Track all user actions and system events
- **Admin Dashboard**: Comprehensive admin panel for system management

### Core Features

✅ **User Management**
- Invite-only registration system
- User profile management
- Email verification
- Password management

✅ **Team Management**
- Create and manage teams
- Invite team members
- Assign roles (Owner, Manager, Member, Viewer)
- Transfer team ownership
- Remove team members

✅ **Instagram Integration**
- Connect Instagram Business accounts
- Schedule posts with images/captions
- View scheduled posts
- Post approval workflow

✅ **Admin Tools**
- User and team management
- Email configuration
- Domain configuration
- Activity monitoring
- System settings

✅ **Security**
- JWT authentication
- Role-based access control
- Email verification
- Secure password handling
- Activity audit trail

---

## Installation & Setup

### Prerequisites

- Python 3.8+
- PostgreSQL or SQLite
- Docker (optional)

### Local Setup

1. **Clone the repository**
```bash
git clone <repository-url>
cd postwave
```

2. **Create virtual environment**
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. **Install dependencies**
```bash
pip install -r requirements.txt
```

4. **Initialize database**
```bash
python
>>> from app import app, db
>>> with app.app_context():
>>>     db.create_all()
>>> exit()
```

5. **Set environment variables** (create `.env` file)
```env
# Application
FLASK_ENV=development
SECRET_KEY=your-secret-key-here
JWT_SECRET_KEY=your-jwt-secret-here

# Database
DATABASE_URL=sqlite:///postwave.db
# OR for PostgreSQL:
DATABASE_URL=postgresql://user:password@localhost/postwave

# Email Configuration
MAIL_SERVER=smtp.gmail.com
MAIL_PORT=587
MAIL_USE_TLS=True
MAIL_USERNAME=your-email@gmail.com
MAIL_PASSWORD=your-app-password
MAIL_DEFAULT_SENDER=noreply@postwave.com

# Instagram
INSTAGRAM_BUSINESS_ACCOUNT_ID=your-account-id

# App Settings
APP_DOMAIN=http://localhost:5500
INVITE_EXPIRY_DAYS=7
```

6. **Run the application**
```bash
python app.py
```

Access at `http://localhost:5500`

### Docker Setup

1. **Build and run**
```bash
docker-compose up --build
```

2. **Initialize database** (in another terminal)
```bash
docker-compose exec web python
>>> from app import app, db
>>> with app.app_context():
>>>     db.create_all()
>>> exit()
```

Access at `http://localhost:5500`

---

## System Architecture

### Technology Stack

- **Backend**: Flask (Python)
- **Frontend**: Vanilla JavaScript with HTML/CSS
- **Database**: SQLAlchemy ORM (supports PostgreSQL, SQLite)
- **Authentication**: JWT tokens
- **Task Queue**: Could extend with Celery
- **External APIs**: Instagram Graph API

### Database Schema

```
Users
  ├── id (PK)
  ├── email
  ├── name
  ├── password_hash
  ├── is_super_admin
  ├── is_active
  └── created_at

Teams
  ├── id (PK)
  ├── name
  ├── created_by (FK → Users.id)
  ├── description
  └── created_at

TeamMembers
  ├── id (PK)
  ├── team_id (FK → Teams.id)
  ├── user_id (FK → Users.id)
  ├── role (owner/manager/member/viewer)
  ├── can_schedule (boolean)
  ├── can_draft (boolean)
  ├── requires_approval (boolean)
  └── joined_at

Invitations
  ├── id (PK)
  ├── team_id (FK → Teams.id)
  ├── email
  ├── invited_by (FK → Users.id)
  ├── token (unique)
  ├── status (pending/accepted/declined)
  ├── expires_at
  └── created_at

Posts
  ├── id (PK)
  ├── team_id (FK → Teams.id)
  ├── created_by (FK → Users.id)
  ├── caption
  ├── image_url
  ├── scheduled_for
  ├── status (draft/scheduled/posted/failed)
  └── created_at

ActivityLogs
  ├── id (PK)
  ├── user_id (FK → Users.id)
  ├── team_id (nullable)
  ├── action_type
  ├── extra_data (JSON)
  └── timestamp
```

### User Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    INVITATION PROCESS                       │
└─────────────────────────────────────────────────────────────┘

Step 1: Admin creates invitation
   ↓
Step 2: Invitation email sent to user
   ↓
Step 3: User clicks invitation link
   ↓
   ├─ NEW USER? → Create account → Login → Accept invitation
   │
   └─ EXISTING USER? → Login (if needed) → Accept invitation
   ↓
Step 4: User added to team
   ↓
Step 5: Complete 4-step onboarding
   ├─ Step 1: Team selection
   ├─ Step 2: Instagram connection
   ├─ Step 3: Account verification
   └─ Step 4: Ready to use!
```

---

## User Roles & Permissions

### Role Hierarchy

| Role | Can Manage Team | Can Manage Members | Can Schedule Posts | Can Create Drafts | Posts Need Approval |
|------|-----------------|--------------------|--------------------|-------------------|---------------------|
| **Owner** | ✅ | ✅ (Full) | ✅ | ✅ | ❌ (Auto-posts) |
| **Manager** | ✅ | ✅ (Limited) | ✅ | ✅ | ❌ (Auto-posts) |
| **Member** | ❌ | ❌ | ✅ | ✅ | ⚠️ (Configurable) |
| **Viewer** | ❌ | ❌ | ❌ | ❌ | N/A (Read-only) |

### Owner
- Full control over team settings
- Can invite and remove members
- Can change member roles and permissions
- Can transfer team ownership
- Can schedule posts without approval
- Can access all team data

### Manager
- Manage most team settings
- Can invite and remove members
- Can schedule posts without approval
- Cannot transfer team ownership
- Cannot change owner role

### Member
- Can schedule posts (if enabled)
- Can create drafts
- Limited access (no team management)
- Posts may require approval (configurable)

### Viewer
- Read-only access to team content
- Cannot schedule posts
- Cannot create drafts
- Cannot manage team settings

---

## API Reference

### Authentication

All API endpoints require JWT authentication. Include token in header:
```
Authorization: Bearer <your_jwt_token>
```

### User Endpoints

#### Login
```
POST /api/auth/login
Body: { "email": "user@example.com", "password": "password" }
Response: { "access_token": "...", "refresh_token": "..." }
```

#### Refresh Token
```
POST /api/auth/refresh
Response: { "access_token": "..." }
```

#### Get Current User
```
GET /api/auth/me
Response: { "id": 1, "name": "John", "email": "john@example.com", ... }
```

### Team Endpoints

#### Get Teams
```
GET /api/teams/teams
Response: [{ "id": 1, "name": "My Team", ... }, ...]
```

#### Create Team
```
POST /api/teams
Body: { "name": "New Team", "description": "..." }
Response: { "id": 2, "name": "New Team", ... }
```

#### Get Team Settings
```
GET /api/team-settings/<team_id>
Response: { "name": "Team", "description": "...", ... }
```

#### Update Team Settings
```
PUT /api/team-settings/<team_id>
Body: { "name": "Updated Name", "description": "..." }
Response: { "success": true }
```

### Team Members Endpoints

#### List Members
```
GET /api/team-settings/<team_id>/members
Response: [{ "id": 1, "name": "John", "email": "john@...", "role": "owner" }, ...]
```

#### Update Member Role
```
PUT /api/team-settings/<team_id>/members/<user_id>
Body: { "role": "manager" }
Response: { "success": true }
```

#### Remove Member
```
DELETE /api/team-settings/<team_id>/members/<user_id>
Response: { "success": true }
```

#### Transfer Ownership
```
POST /api/team-settings/<team_id>/transfer-ownership
Body: { "new_owner_id": 3 }
Response: { "success": true }
```

### Invitation Endpoints

#### Send Invitation
```
POST /api/team-settings/<team_id>/send-invite
Body: { "email": "newuser@example.com" }
Response: { "success": true, "invitation_id": 1 }
```

#### Accept Invitation
```
POST /api/invitations/<token>/accept
Response: { "success": true, "team_id": 1 }
```

#### Decline Invitation
```
POST /api/invitations/<token>/decline
Response: { "success": true }
```

### Admin Endpoints

#### List Users (Super Admin Only)
```
GET /api/admin-settings/users
Response: [{ "id": 1, "name": "John", "email": "john@...", "is_super_admin": false }, ...]
```

#### List Teams (Super Admin Only)
```
GET /api/admin-settings/teams
Response: [{ "id": 1, "name": "Team 1", "created_by": 1 }, ...]
```

#### Get Domain Settings (Super Admin Only)
```
GET /api/admin-settings/domain
Response: { "domain": "http://localhost:5500" }
```

#### Update Domain Settings (Super Admin Only)
```
POST /api/admin-settings/domain
Body: { "domain": "https://postwave.example.com" }
Response: { "success": true }
```

---

## Configuration

### Environment Variables

#### Application Settings
- `FLASK_ENV` - Environment (development/production)
- `SECRET_KEY` - Flask secret key
- `JWT_SECRET_KEY` - JWT signing secret

#### Database
- `DATABASE_URL` - Database connection string
  - SQLite: `sqlite:///postwave.db`
  - PostgreSQL: `postgresql://user:password@localhost/postwave`

#### Email Configuration
- `MAIL_SERVER` - SMTP server (e.g., smtp.gmail.com)
- `MAIL_PORT` - SMTP port (usually 587)
- `MAIL_USE_TLS` - Use TLS (True/False)
- `MAIL_USERNAME` - Email address
- `MAIL_PASSWORD` - Email password or app-specific password
- `MAIL_DEFAULT_SENDER` - From address

#### Instagram Settings
- `INSTAGRAM_BUSINESS_ACCOUNT_ID` - Your Instagram Business Account ID

#### Application Configuration
- `APP_DOMAIN` - Public domain (used in email links)
- `INVITE_EXPIRY_DAYS` - Invitation expiration (default: 7 days)

### Email Configuration Examples

**Gmail**
```env
MAIL_SERVER=smtp.gmail.com
MAIL_PORT=587
MAIL_USE_TLS=True
MAIL_USERNAME=your-email@gmail.com
MAIL_PASSWORD=your-app-password  # Use App Passwords, not regular password
```

**Outlook**
```env
MAIL_SERVER=smtp-mail.outlook.com
MAIL_PORT=587
MAIL_USE_TLS=True
MAIL_USERNAME=your-email@outlook.com
MAIL_PASSWORD=your-password
```

**SendGrid**
```env
MAIL_SERVER=smtp.sendgrid.net
MAIL_PORT=587
MAIL_USE_TLS=True
MAIL_USERNAME=apikey
MAIL_PASSWORD=SG.your-sendgrid-api-key
```

---

## Troubleshooting

### Common Issues

#### "Invalid Invitation" Error
- **Cause**: Invitation token expired or invalid
- **Solution**: Ask administrator to resend invitation

#### "Email configuration error"
- **Cause**: MAIL_SERVER or credentials not set correctly
- **Solution**: 
  1. Check SMTP settings in admin settings
  2. For Gmail, use [App Passwords](https://support.google.com/accounts/answer/185833)
  3. Test with `python -c "import smtplib; s = smtplib.SMTP('smtp.gmail.com', 587)"`

#### "Database connection failed"
- **Cause**: DATABASE_URL not set or connection failed
- **Solution**:
  1. Check DATABASE_URL environment variable
  2. Ensure database server is running
  3. Verify credentials and network connectivity

#### "JWT token expired"
- **Cause**: Session expired
- **Solution**: Refresh token using `/api/auth/refresh` or login again

#### "Permission denied" on API calls
- **Cause**: User lacks required role
- **Solution**: Request team owner to change your role

#### "Instagram connection failed"
- **Cause**: Invalid access token
- **Solution**:
  1. Re-authenticate with Instagram
  2. Check token permissions in Instagram settings
  3. Ensure token hasn't expired

### Debug Mode

Enable detailed logging:
```python
# In app.py or .env
FLASK_DEBUG=True
LOG_LEVEL=DEBUG
```

View logs:
```bash
tail -f logs/igscheduler.log
```

### Database Reset (Development Only)

```python
python
>>> from app import app, db
>>> with app.app_context():
>>>     db.drop_all()
>>>     db.create_all()
>>> exit()
```

---

## Additional Resources

- **GitHub**: [PostWave Repository](https://github.com/yourusername/postwave)
- **Issues**: Report bugs and feature requests on GitHub Issues
- **Contributing**: See CONTRIBUTING.md for guidelines

---

**Last Updated**: January 12, 2026
**Version**: 1.0.0
