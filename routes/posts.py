from flask import Blueprint, request, jsonify, send_from_directory
from flask_jwt_extended import jwt_required, get_jwt_identity
from werkzeug.utils import secure_filename
from models import db, User, Post, Media
from datetime import datetime
import os
from config import Config

posts_bp = Blueprint('posts', __name__)

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in Config.ALLOWED_EXTENSIONS


def invalidate_dashboard_cache():
    """Helper function to invalidate dashboard cache when posts change"""
    # The frontend will clear localStorage cache on specific operations
    # This is called after any post modifications to signal the frontend
    pass


@posts_bp.route('/', methods=['GET'])
@jwt_required()
def get_posts():
    """
    Get all posts for current user.
    Query params: status (optional), limit, offset
    """
    current_user_id = int(get_jwt_identity())
    
    status = request.args.get('status')
    limit = request.args.get('limit', 50, type=int)
    offset = request.args.get('offset', 0, type=int)
    
    query = Post.query.filter_by(user_id=current_user_id)
    
    if status:
        query = query.filter_by(status=status)
    
    query = query.order_by(Post.scheduled_time.desc())
    posts = query.limit(limit).offset(offset).all()
    
    return jsonify({
        'posts': [post.to_dict() for post in posts],
        'total': query.count()
    }), 200


@posts_bp.route('/<int:post_id>', methods=['GET'])
@jwt_required()
def get_post(post_id):
    """
    Get a specific post.
    """
    current_user_id = int(get_jwt_identity())
    post = Post.query.filter_by(id=post_id, user_id=current_user_id).first()
    
    if not post:
        return jsonify({'error': 'Post not found'}), 404
    
    return jsonify(post.to_dict()), 200


@posts_bp.route('/', methods=['POST'])
@jwt_required()
def create_post():
    """
    Create a new post with media files.
    """
    current_user_id = int(get_jwt_identity())
    
    # Get form data
    caption = request.form.get('caption', '')
    scheduled_time_str = request.form.get('scheduled_time')
    status = request.form.get('status', 'draft')
    
    if not scheduled_time_str:
        return jsonify({'error': 'scheduled_time is required'}), 400
    
    try:
        # Parse as local time (not UTC)
        scheduled_time = datetime.fromisoformat(scheduled_time_str)
    except ValueError:
        return jsonify({'error': 'Invalid datetime format'}), 400
    
    # Validate status
    if status not in ['draft', 'scheduled']:
        return jsonify({'error': 'Invalid status. Must be draft or scheduled'}), 400
    
    # Get uploaded files
    files = request.files.getlist('media')
    
    if not files or len(files) == 0:
        return jsonify({'error': 'At least one media file is required'}), 400
    
    if len(files) > 10:
        return jsonify({'error': 'Maximum 10 media files allowed'}), 400
    
    # Validate all files
    for file in files:
        if not file or file.filename == '':
            return jsonify({'error': 'Invalid file'}), 400
        if not allowed_file(file.filename):
            return jsonify({'error': f'File type not allowed: {file.filename}'}), 400
    
    # Create post
    post = Post(
        user_id=current_user_id,
        caption=caption,
        scheduled_time=scheduled_time,
        status=status
    )
    
    db.session.add(post)
    db.session.flush()  # Get post ID
    
    # Save files and create media records
    for idx, file in enumerate(files):
        filename = secure_filename(file.filename)
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        unique_filename = f"{current_user_id}_{post.id}_{timestamp}_{idx}_{filename}"
        filepath = os.path.join(Config.UPLOAD_FOLDER, unique_filename)
        
        file.save(filepath)
        
        # Determine media type
        ext = filename.rsplit('.', 1)[1].lower()
        media_type = 'video' if ext == 'mp4' else 'image'
        
        media = Media(
            post_id=post.id,
            filename=unique_filename,
            filepath=filepath,
            media_type=media_type,
            order=idx
        )
        db.session.add(media)
    
    db.session.commit()
    
    # Add cache invalidation response header
    response = jsonify({
        'message': 'Post created successfully',
        'post': post.to_dict(),
        'invalidate_cache': True
    })
    response.headers['X-Invalidate-Dashboard-Cache'] = 'true'
    return response, 201


@posts_bp.route('/<int:post_id>', methods=['PUT'])
@jwt_required()
def update_post(post_id):
    """
    Update a post.
    """
    current_user_id = int(get_jwt_identity())
    post = Post.query.filter_by(id=post_id, user_id=current_user_id).first()
    
    if not post:
        return jsonify({'error': 'Post not found'}), 404
    
    if post.status == 'published':
        return jsonify({'error': 'Cannot edit published post'}), 400
    
    data = request.get_json()
    
    if 'caption' in data:
        post.caption = data['caption']
    
    if 'scheduled_time' in data:
        try:
            # Parse as local time (not UTC)
            post.scheduled_time = datetime.fromisoformat(data['scheduled_time'])
        except ValueError:
            return jsonify({'error': 'Invalid datetime format'}), 400
    
    if 'status' in data:
        if data['status'] not in ['draft', 'scheduled']:
            return jsonify({'error': 'Invalid status'}), 400
        post.status = data['status']
    
    db.session.commit()
    
    response = jsonify({
        'message': 'Post updated successfully',
        'post': post.to_dict(),
        'invalidate_cache': True
    })
    response.headers['X-Invalidate-Dashboard-Cache'] = 'true'
    return response, 200


@posts_bp.route('/<int:post_id>', methods=['DELETE'])
@jwt_required()
def delete_post(post_id):
    """
    Delete a post and its media files.
    """
    current_user_id = int(get_jwt_identity())
    post = Post.query.filter_by(id=post_id, user_id=current_user_id).first()
    
    if not post:
        return jsonify({'error': 'Post not found'}), 404
    
    # Delete media files
    for media in post.media:
        try:
            if os.path.exists(media.filepath):
                os.remove(media.filepath)
        except Exception as e:
            print(f"Error deleting file {media.filepath}: {e}")
    
    db.session.delete(post)
    db.session.commit()
    
    response = jsonify({
        'message': 'Post deleted successfully',
        'invalidate_cache': True
    })
    response.headers['X-Invalidate-Dashboard-Cache'] = 'true'
    return response, 200


@posts_bp.route('/<int:post_id>/publish', methods=['POST'])
@jwt_required()
def publish_post_now(post_id):
    """
    Publish a post immediately (for testing).
    """
    current_user_id = int(get_jwt_identity())
    post = Post.query.filter_by(id=post_id, user_id=current_user_id).first()
    
    if not post:
        return jsonify({'error': 'Post not found'}), 404
    
    if post.status == 'published':
        return jsonify({'error': 'Post already published'}), 400
    
    user = User.query.get(current_user_id)
    
    if not user.instagram_access_token or not user.instagram_account_id:
        return jsonify({'error': 'Instagram not connected'}), 400
    
    from instagram_api import InstagramAPI
    ig_api = InstagramAPI()
    
    try:
        # Note: In production, media URLs need to be publicly accessible
        media_urls = [
            f"http://your-domain.com/api/posts/media/{media.id}"
            for media in post.media
        ]
        
        instagram_post_id = ig_api.publish_post(
            user.instagram_access_token,
            user.instagram_account_id,
            media_urls,
            post.caption
        )
        
        post.status = 'published'
        post.instagram_post_id = instagram_post_id
        post.published_at = datetime.utcnow()
        post.error_message = None
        
        db.session.commit()
        
        response = jsonify({
            'message': 'Post published successfully',
            'post': post.to_dict(),
            'invalidate_cache': True
        })
        response.headers['X-Invalidate-Dashboard-Cache'] = 'true'
        return response, 200
    
    except Exception as e:
        post.status = 'failed'
        post.error_message = str(e)
        db.session.commit()
        
        return jsonify({'error': str(e)}), 400


@posts_bp.route('/media/<int:media_id>', methods=['GET'])
def serve_media(media_id):
    """
    Serve media file (for preview and Instagram API).
    """
    media = Media.query.get(media_id)
    
    if not media:
        return jsonify({'error': 'Media not found'}), 404
    
    return send_from_directory(
        Config.UPLOAD_FOLDER,
        media.filename,
        as_attachment=False
    )


@posts_bp.route('/upcoming', methods=['GET'])
@jwt_required()
def get_upcoming_posts():
    """
    Get upcoming scheduled posts.
    """
    current_user_id = int(get_jwt_identity())
    
    now = datetime.utcnow()
    posts = Post.query.filter(
        Post.user_id == current_user_id,
        Post.status == 'scheduled',
        Post.scheduled_time >= now
    ).order_by(Post.scheduled_time.asc()).limit(10).all()
    
    return jsonify({
        'posts': [post.to_dict() for post in posts]
    }), 200
