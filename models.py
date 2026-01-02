from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

db = SQLAlchemy()

class User(db.Model):
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    is_active = db.Column(db.Boolean, default=True)
    
    # Instagram connection
    instagram_account_id = db.Column(db.String(255), nullable=True)
    instagram_access_token = db.Column(db.Text, nullable=True)
    instagram_username = db.Column(db.String(255), nullable=True)
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
            'username': self.username,
            'email': self.email,
            'created_at': self.created_at.isoformat(),
            'instagram_connected': bool(self.instagram_account_id),
            'instagram_username': self.instagram_username
        }


class Post(db.Model):
    __tablename__ = 'posts'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    
    # Post content
    caption = db.Column(db.Text, nullable=True)
    scheduled_time = db.Column(db.DateTime, nullable=False)
    
    # Status: scheduled, published, failed, draft
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
