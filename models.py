from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

db = SQLAlchemy()

class User(db.Model):
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)  # Display name
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    is_active = db.Column(db.Boolean, default=True)
    is_super_admin = db.Column(db.Boolean, default=False)
    
    # Instagram connection
    instagram_account_id = db.Column(db.String(255), nullable=True)
    instagram_access_token = db.Column(db.Text, nullable=True)
    instagram_username = db.Column(db.String(255), nullable=True)
    instagram_profile_picture = db.Column(db.Text, nullable=True)  # Cached profile picture URL
    token_expires_at = db.Column(db.DateTime, nullable=True)
    
    # Relationships
    posts = db.relationship('Post', backref='user', lazy=True, cascade='all, delete-orphan')
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)
    
    def to_dict(self):
        return {
            'id': self.id,
            'email': self.email,
            'name': self.name,
            'created_at': self.created_at.isoformat(),
            'is_super_admin': self.is_super_admin,
            'instagram_connected': bool(self.instagram_account_id),
            'instagram_username': self.instagram_username,
            'profile_picture': self.instagram_profile_picture
        }


class Post(db.Model):
    __tablename__ = 'posts'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    team_id = db.Column(db.Integer, db.ForeignKey('teams.id'), nullable=True)  # NULL for standalone posts
    
    # Post content
    caption = db.Column(db.Text, nullable=True)
    scheduled_time = db.Column(db.DateTime, nullable=False)
    
    # Status: scheduled, published, failed, draft, pending_approval, rejected
    status = db.Column(db.String(20), default='draft')
    
    # Instagram response
    instagram_post_id = db.Column(db.String(255), nullable=True)
    error_message = db.Column(db.Text, nullable=True)
    published_at = db.Column(db.DateTime, nullable=True)
    
    # Metadata
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    media = db.relationship('Media', backref='post', lazy=True, cascade='all, delete-orphan', order_by='Media.order')
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'team_id': self.team_id,
            'caption': self.caption,
            'scheduled_time': self.scheduled_time.isoformat(),
            'status': self.status,
            'instagram_post_id': self.instagram_post_id,
            'error_message': self.error_message,
            'published_at': self.published_at.isoformat() if self.published_at else None,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
            'media': [m.to_dict() for m in self.media]
        }


class Media(db.Model):
    __tablename__ = 'media'
    
    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey('posts.id'), nullable=False)
    
    # File information
    filename = db.Column(db.String(255), nullable=False)
    filepath = db.Column(db.String(500), nullable=False)
    media_type = db.Column(db.String(20), nullable=False)  # image or video
    order = db.Column(db.Integer, default=0)
    
    # Instagram container ID (used during publishing)
    container_id = db.Column(db.String(255), nullable=True)
    
    # Metadata
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'post_id': self.post_id,
            'filename': self.filename,
            'filepath': self.filepath,
            'media_type': self.media_type,
            'order': self.order,
            'created_at': self.created_at.isoformat()
        }


class InstagramCache(db.Model):
    __tablename__ = 'instagram_cache'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    
    # Cache data
    instagram_post_id = db.Column(db.String(255), unique=True, nullable=False, index=True)
    post_data = db.Column(db.JSON, nullable=False)  # Cached post metadata
    
    # Image cache info
    cached_image_path = db.Column(db.String(500), nullable=True)  # Local path to cached image
    image_filename = db.Column(db.String(255), nullable=True)  # Original image filename
    
    # Cache lifecycle
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=False, index=True)  # 30 days from creation
    
    def to_dict(self, include_image_url=True):
        """Convert cache to dict, optionally including image URL"""
        data = {
            'id': self.id,
            'instagram_post_id': self.instagram_post_id,
            'post_data': self.post_data,
            'created_at': self.created_at.isoformat(),
            'expires_at': self.expires_at.isoformat(),
            'is_expired': datetime.utcnow() > self.expires_at
        }
        
        if include_image_url and self.cached_image_path:
            # Return URL path to cached image
            data['cached_image_url'] = f"/api/cache/image/{self.id}"
        
        return data
    
    def is_valid(self):
        """Check if cache is still valid"""
        return datetime.utcnow() <= self.expires_at


class Team(db.Model):
    __tablename__ = 'teams'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Instagram API credentials for this team
    instagram_account_id = db.Column(db.String(255), nullable=True)
    instagram_access_token = db.Column(db.Text, nullable=True)
    instagram_username = db.Column(db.String(255), nullable=True)
    instagram_profile_picture = db.Column(db.Text, nullable=True)
    token_expires_at = db.Column(db.DateTime, nullable=True)
    
    # Optional: Team-specific Instagram App credentials for token exchange
    instagram_app_id = db.Column(db.String(255), nullable=True)
    instagram_app_secret = db.Column(db.Text, nullable=True)
    
    # Relationships
    members = db.relationship('TeamMember', backref='team', lazy=True, cascade='all, delete-orphan')
    posts = db.relationship('Post', backref='team', lazy=True, cascade='all, delete-orphan')
    
    def to_dict(self, include_members=False):
        data = {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'created_by': self.created_by,
            'created_at': self.created_at.isoformat(),
            'instagram_username': self.instagram_username,
            'instagram_connected': bool(self.instagram_account_id)
        }
        if include_members:
            data['members'] = [m.to_dict() for m in self.members]
        return data


class TeamMember(db.Model):
    __tablename__ = 'team_members'
    
    id = db.Column(db.Integer, primary_key=True)
    team_id = db.Column(db.Integer, db.ForeignKey('teams.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    
    # Role: 'owner', 'manager', 'member', or 'viewer'
    role = db.Column(db.String(20), default='member', nullable=False)
    
    # Permissions for team members
    can_schedule = db.Column(db.Boolean, default=True)  # Can schedule posts
    can_draft = db.Column(db.Boolean, default=True)  # Can create drafts
    requires_approval = db.Column(db.Boolean, default=False)  # Member posts need approval
    
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    user = db.relationship('User', backref='team_memberships')
    
    def to_dict(self):
        return {
            'id': self.id,
            'team_id': self.team_id,
            'user_id': self.user_id,
            'name': self.user.name,
            'email': self.user.email,
            'role': self.role,
            'can_schedule': self.can_schedule,
            'can_draft': self.can_draft,
            'requires_approval': self.requires_approval,
            'joined_at': self.joined_at.isoformat()
        }


class Invitation(db.Model):
    __tablename__ = 'invitations'
    
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), nullable=False, index=True)
    team_id = db.Column(db.Integer, db.ForeignKey('teams.id'), nullable=True)
    invited_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    
    # Role to assign when user joins
    role = db.Column(db.String(20), default='member', nullable=False)
    
    # Approval requirements for this member
    requires_approval = db.Column(db.Boolean, default=False)
    
    # Status: 'pending', 'accepted', 'declined'
    status = db.Column(db.String(20), default='pending', nullable=False)
    
    # Token for email link
    token = db.Column(db.String(255), unique=True, nullable=False, index=True)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=False)  # 7 days from creation
    
    def to_dict(self):
        return {
            'id': self.id,
            'email': self.email,
            'team_id': self.team_id,
            'role': self.role,
            'status': self.status,
            'created_at': self.created_at.isoformat(),
            'expires_at': self.expires_at.isoformat()
        }


class PostApproval(db.Model):
    __tablename__ = 'post_approvals'
    
    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey('posts.id'), nullable=False)
    team_id = db.Column(db.Integer, db.ForeignKey('teams.id'), nullable=False)
    
    # Approval status: 'pending', 'approved', 'rejected'
    status = db.Column(db.String(20), default='pending', nullable=False)
    
    # Who approved/rejected
    reviewed_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    review_comments = db.Column(db.Text, nullable=True)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    reviewed_at = db.Column(db.DateTime, nullable=True)
    
    post = db.relationship('Post', backref='approvals')
    team = db.relationship('Team')
    reviewer = db.relationship('User', foreign_keys=[reviewed_by])
    
    def to_dict(self):
        return {
            'id': self.id,
            'post_id': self.post_id,
            'team_id': self.team_id,
            'status': self.status,
            'reviewed_by': self.reviewed_by,
            'review_comments': self.review_comments,
            'created_at': self.created_at.isoformat(),
            'reviewed_at': self.reviewed_at.isoformat() if self.reviewed_at else None
        }


class Settings(db.Model):
    __tablename__ = 'settings'
    
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(255), unique=True, nullable=False, index=True)
    value = db.Column(db.Text, nullable=True)
    setting_type = db.Column(db.String(50), default='string')  # string, integer, boolean
    description = db.Column(db.String(500), nullable=True)
    editable = db.Column(db.Boolean, default=True)  # Some settings shouldn't be editable
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
        return {
            'key': self.key,
            'value': self.value,
            'type': self.setting_type,
            'description': self.description,
            'editable': self.editable
        }


class ActivityLog(db.Model):
    __tablename__ = 'activity_logs'
    
    id = db.Column(db.Integer, primary_key=True)
    team_id = db.Column(db.Integer, db.ForeignKey('teams.id'), nullable=True)  # None for admin logs
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)  # Who performed the action
    action_type = db.Column(db.String(50), nullable=False)  # api_call, member_added, config_changed, post_scheduled, post_edited, post_deleted
    description = db.Column(db.Text, nullable=False)
    resource_type = db.Column(db.String(50), nullable=True)  # team, user, post, settings, etc.
    resource_id = db.Column(db.Integer, nullable=True)  # ID of affected resource
    extra_data = db.Column(db.JSON, nullable=True)  # Additional details (old_value, new_value, etc.)
    ip_address = db.Column(db.String(45), nullable=True)  # IPv4 or IPv6
    user_agent = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    
    user = db.relationship('User', backref='activity_logs')
    team = db.relationship('Team', backref='activity_logs')
    
    def to_dict(self):
        return {
            'id': self.id,
            'team_id': self.team_id,
            'user_id': self.user_id,
            'user_name': self.user.name if self.user else 'Unknown',
            'action_type': self.action_type,
            'description': self.description,
            'resource_type': self.resource_type,
            'resource_id': self.resource_id,
            'extra_data': self.extra_data,
            'ip_address': self.ip_address,
            'created_at': self.created_at.isoformat()
        }
