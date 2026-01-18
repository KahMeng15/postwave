import os
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from apscheduler.schedulers.background import BackgroundScheduler
from config import Config
from models import db
from datetime import datetime
import atexit
import logging
from logging.handlers import TimedRotatingFileHandler

# Global variable to store app instance for scheduler
scheduler_app = None

def create_app(config_class=Config):
    global scheduler_app
    
    app = Flask(__name__, static_folder='static', static_url_path='')
    app.config.from_object(config_class)
    
    # Setup logging
    if not os.path.exists('logs'):
        os.mkdir('logs')
    # Rotate logs daily, keep 90 days of logs
    file_handler = TimedRotatingFileHandler('logs/igscheduler.log', when='midnight', interval=1, backupCount=90)
    file_handler.setFormatter(logging.Formatter(
        '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
    ))
    file_handler.setLevel(logging.INFO)
    app.logger.addHandler(file_handler)
    app.logger.setLevel(logging.INFO)
    
    # Initialize extensions
    db.init_app(app)
    CORS(app, 
         origins=[
            "http://127.0.0.1:5500",
            "http://127.0.0.1:5000",
            "http://localhost:5500",
            "http://localhost:5000",
            "http://127.0.0.1:3000",
            "http://localhost:3000"
        ],
         supports_credentials=True,
         allow_headers=['Content-Type', 'Authorization'],
         methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'])
    jwt = JWTManager(app)
    
    # Create upload folder if it doesn't exist
    upload_path = app.config['UPLOAD_FOLDER'].lstrip('./')
    os.makedirs(upload_path, exist_ok=True)
    
    # Register blueprints
    from routes.auth import auth_bp
    from routes.posts import posts_bp
    from routes.instagram import instagram_bp
    from routes.users import users_bp
    
    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(posts_bp, url_prefix='/api/posts')
    app.register_blueprint(instagram_bp, url_prefix='/api/instagram')
    app.register_blueprint(users_bp, url_prefix='/api/users')
    
    # Register new team and posts approval blueprints
    from routes.teams import teams_bp
    from routes.posts_approval import posts_bp as posts_approval_bp
    from routes.settings import settings_bp
    from routes.admin_settings import admin_settings_bp
    from routes.team_settings import team_settings_bp
    from routes.user_settings import user_settings_bp
    
    app.register_blueprint(teams_bp, url_prefix='/api/teams')
    app.register_blueprint(posts_approval_bp, url_prefix='/api/posts-approval', name='posts_approval')
    app.register_blueprint(settings_bp, url_prefix='/api/settings')
    app.register_blueprint(admin_settings_bp)
    app.register_blueprint(team_settings_bp)
    app.register_blueprint(user_settings_bp)
    
    # Store app instance for scheduler to use
    scheduler_app = app
    
    # Initialize scheduler
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        func=check_scheduled_posts,
        trigger="interval",
        minutes=1,
        id='check_posts',
        name='Check and publish scheduled posts',
        replace_existing=True
    )
    scheduler.add_job(
        func=cleanup_expired_cache,
        trigger="interval",
        hours=6,  # Run every 6 hours
        id='cleanup_cache',
        name='Clean up expired Instagram cache',
        replace_existing=True
    )
    scheduler.add_job(
        func=refresh_instagram_cache,
        trigger="interval",
        minutes=30,  # Run every 30 minutes
        id='refresh_cache',
        name='Refresh Instagram cache and posts',
        replace_existing=True
    )
    scheduler.start()
    
    # Shut down the scheduler when exiting the app
    atexit.register(lambda: scheduler.shutdown())
    
    # Create database tables
    with app.app_context():
        db.create_all()
    
    # Add cache control headers for static files to prevent stale caching
    @app.after_request
    def add_cache_headers(response):
        # Don't cache JavaScript and CSS files aggressively
        if request.path.endswith(('.js', '.css')):
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
        # Allow caching for images
        elif request.path.endswith(('.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg')):
            response.headers['Cache-Control'] = 'public, max-age=86400'  # 1 day
        # Don't cache HTML files
        elif request.path.endswith('.html') or request.path == '/' or '.' not in request.path:
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
        return response
    
    # Error handlers
    @app.errorhandler(404)
    def not_found(error):
        # For SPA routing: serve base.html for non-API routes
        if request.path.startswith('/api/'):
            return jsonify({'error': 'Not found'}), 404
        return app.send_static_file('base.html')
    
    @app.errorhandler(500)
    def internal_error(error):
        return jsonify({'error': 'Internal server error'}), 500
    
    # Health check
    @app.route('/api/health')
    def health():
        return jsonify({'status': 'healthy', 'timestamp': datetime.utcnow().isoformat()})
    
    # Serve base.html for root
    @app.route('/')
    def index():
        return app.send_static_file('base.html')
    
    # Serve individual page HTML files
    @app.route('/pages/<path:filename>')
    def serve_pages(filename):
        return app.send_static_file(f'pages/{filename}')
    
    # Catch-all for SPA routes (login, register, dashboard, posts, etc.)
    # This must be the last route defined
    @app.route('/<path:path>')
    def catch_all(path):
        # If it's not a static file or API, serve the base.html for client-side routing
        if not path.startswith('api/') and '.' not in path:
            return app.send_static_file('base.html')
        return jsonify({'error': 'Not found'}), 404
    
    return app


def check_scheduled_posts():
    """
    Background task to check and publish scheduled posts.
    """
    from models import Post, User, Team, Settings, db
    from instagram_api import InstagramAPI
    
    with scheduler_app.app_context():
        scheduler_app.logger.info('=' * 80)
        scheduler_app.logger.info('Starting check_scheduled_posts task')
        scheduler_app.logger.info('=' * 80)
        
        # Find posts that are scheduled and due
        # Use naive datetime comparison (both stored as local time)
        now = datetime.now()
        scheduler_app.logger.info(f'Current time: {now}')
        
        posts = Post.query.filter(
            Post.status == 'scheduled',
            Post.scheduled_time <= now
        ).all()
        
        scheduler_app.logger.info(f'Found {len(posts)} scheduled posts to process')
        
        if not posts:
            scheduler_app.logger.info('No scheduled posts found. Exiting.')
            return
        
        ig_api = InstagramAPI()
        
        for post in posts:
            try:
                scheduler_app.logger.info(f'\n--- Processing Post {post.id} ---')
                scheduler_app.logger.info(f'Post scheduled time: {post.scheduled_time}')
                scheduler_app.logger.info(f'Post caption length: {len(post.caption or "")}')
                scheduler_app.logger.info(f'Post media count: {len(post.media)}')
                
                # Update status immediately to prevent duplicate publishing attempts
                post.status = 'publishing'
                db.session.commit()
                scheduler_app.logger.info(f'Updated post {post.id} status to publishing')
                
                user = User.query.get(post.user_id)
                
                if not user:
                    post.status = 'failed'
                    post.error_message = 'User not found'
                    db.session.commit()
                    scheduler_app.logger.error(f'User {post.user_id} not found for post {post.id}')
                    continue
                
                # Get user's team (for team-based apps)
                if not hasattr(user, 'team_memberships') or not user.team_memberships:
                    post.status = 'failed'
                    post.error_message = 'User is not a member of any team'
                    db.session.commit()
                    scheduler_app.logger.error(f'User {user.id} is not a member of any team')
                    continue
                
                team = user.team_memberships[0].team
                if not team:
                    post.status = 'failed'
                    post.error_message = 'Team not found'
                    db.session.commit()
                    scheduler_app.logger.error(f'Team not found for user {user.id}')
                    continue
                
                scheduler_app.logger.info(f'Processing post {post.id} for user {user.id} ({user.email}) in team {team.id} ({team.name})')
                scheduler_app.logger.info(f'Team Instagram Account ID: {team.instagram_account_id}')
                scheduler_app.logger.info(f'Team Instagram Access Token Present: {bool(team.instagram_access_token)}')
                
                if not team.instagram_access_token or not team.instagram_account_id:
                    post.status = 'failed'
                    post.error_message = 'Instagram not connected'
                    db.session.commit()
                    scheduler_app.logger.error(f'Instagram not connected for team {team.id}. Token: {bool(team.instagram_access_token)}, Account ID: {bool(team.instagram_account_id)}')
                    continue
                
                # Skip posts without media
                if not post.media:
                    post.status = 'failed'
                    post.error_message = 'No media files attached'
                    db.session.commit()
                    scheduler_app.logger.error(f'Post {post.id} has no media files')
                    continue
                
                # Get the public host URL from settings, fallback to environment variable
                domain_setting = Settings.query.filter_by(key='app_domain').first()
                app_host = domain_setting.value if domain_setting else os.getenv('APP_HOST', 'http://127.0.0.1:5500')
                scheduler_app.logger.info(f'Using app host: {app_host}')
                
                # Prepare publicly accessible media URLs
                media_urls = [
                    f"{app_host}/api/posts/media/{media.id}"
                    for media in post.media
                ]
                
                scheduler_app.logger.info(f'Publishing post {post.id} with {len(media_urls)} media items')
                scheduler_app.logger.info(f'Media URLs: {media_urls}')
                
                # Publish to Instagram using URLs
                instagram_post_id = ig_api.publish_post(
                    team.instagram_access_token,
                    team.instagram_account_id,
                    media_urls,
                    post.caption
                )
                
                scheduler_app.logger.info(f'Instagram API returned post ID: {instagram_post_id}')
                
                post.status = 'published'
                post.instagram_post_id = instagram_post_id
                post.published_at = datetime.now()
                post.error_message = None
                scheduler_app.logger.info(f'Successfully published post {post.id} to Instagram with ID: {instagram_post_id}')
                
            except Exception as e:
                scheduler_app.logger.error(f'Failed to publish post {post.id}: {str(e)}', exc_info=True)
                post.status = 'failed'
                post.error_message = str(e)
                db.session.commit()
            
            else:
                # Only commit if no exception occurred
                db.session.commit()
        
        scheduler_app.logger.info('=' * 80)
        scheduler_app.logger.info('Finished check_scheduled_posts task')
        scheduler_app.logger.info('=' * 80)


def cleanup_expired_cache():
    """
    Background task to clean up expired Instagram cache entries.
    Runs every 6 hours.
    """
    from cache_manager import CacheManager
    
    with scheduler_app.app_context():
        try:
            deleted_count = CacheManager.clear_expired_cache()
            scheduler_app.logger.info(f'Cache cleanup: Removed {deleted_count} expired entries')
        except Exception as e:
            scheduler_app.logger.error(f'Failed to clean up cache: {str(e)}', exc_info=True)


def refresh_instagram_cache():
    """
    Background task to refresh Instagram cache and post data.
    Runs every 30 minutes for all active users.
    """
    from models import User
    from instagram_api import InstagramAPI
    from cache_manager import CacheManager
    
    with scheduler_app.app_context():
        try:
            ig_api = InstagramAPI()
            users = User.query.filter(User.instagram_account_id.isnot(None)).all()
            
            refreshed_count = 0
            for user in users:
                try:
                    if user.instagram_access_token and user.instagram_account_id:
                        # Fetch fresh media from Instagram API
                        media_list = ig_api.get_media_list(
                            user.instagram_access_token,
                            user.instagram_account_id,
                            limit=25
                        )
                        
                        # Cache the fresh posts
                        CacheManager.cache_posts_batch(user.id, media_list)
                        refreshed_count += 1
                        scheduler_app.logger.debug(f'Refreshed cache for user {user.id}')
                except Exception as e:
                    scheduler_app.logger.debug(f'Failed to refresh cache for user {user.id}: {str(e)}')
            
            scheduler_app.logger.info(f'Instagram cache refresh completed for {refreshed_count} users')
        except Exception as e:
            scheduler_app.logger.error(f'Failed to refresh Instagram cache: {str(e)}', exc_info=True)



if __name__ == '__main__':
    app = create_app()
    app.run(
        host=Config.HOST,
        port=Config.PORT,
        debug=Config.FLASK_ENV == 'development'
    )
