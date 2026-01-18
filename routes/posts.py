from flask import Blueprint, request, jsonify, send_from_directory
from flask_jwt_extended import jwt_required, get_jwt_identity
from werkzeug.utils import secure_filename
from models import db, User, Post, Media, Team, Settings
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
    Update a post with media files (full update including media).
    """
    current_user_id = int(get_jwt_identity())
    post = Post.query.filter_by(id=post_id, user_id=current_user_id).first()
    
    if not post:
        return jsonify({'error': 'Post not found'}), 404
    
    if post.status == 'published':
        return jsonify({'error': 'Cannot edit published post'}), 400
    
    # Get form data
    caption = request.form.get('caption', '')
    scheduled_time_str = request.form.get('scheduled_time')
    status = request.form.get('status', post.status)
    
    # Get list of media IDs to keep (if provided)
    keep_media_ids_str = request.form.get('keep_media_ids', '')
    keep_media_ids = [int(mid) for mid in keep_media_ids_str.split(',') if mid.strip()] if keep_media_ids_str else []
    
    # Update caption
    post.caption = caption
    
    # Update scheduled time
    if scheduled_time_str:
        try:
            post.scheduled_time = datetime.fromisoformat(scheduled_time_str)
        except ValueError:
            return jsonify({'error': 'Invalid datetime format'}), 400
    
    # Update status
    if status not in ['draft', 'scheduled']:
        return jsonify({'error': 'Invalid status'}), 400
    post.status = status
    
    # Handle media updates
    # Step 1: Delete media that are not in keep_media_ids
    for media in list(post.media):
        if media.id not in keep_media_ids:
            try:
                if os.path.exists(media.filepath):
                    os.remove(media.filepath)
            except Exception as e:
                print(f"Error deleting file {media.filepath}: {e}")
            db.session.delete(media)
    
    db.session.flush()  # Apply deletions
    
    # Step 2: Determine desired final order using media_sequence (if provided) to support interleaving existing and new media
    media_sequence_raw = request.form.get('media_sequence')
    try:
        media_sequence = []
        if media_sequence_raw:
            media_sequence = json.loads(media_sequence_raw)
            if not isinstance(media_sequence, list):
                media_sequence = []
    except Exception:
        media_sequence = []
    
    # Step 3: Get new uploaded files (preserves order they were appended)
    new_files = request.files.getlist('media')
    valid_new_files = [f for f in new_files if f and f.filename]
    new_file_index = 0
    
    # Validate total media count using desired final order when sequence provided, otherwise fallback
    total_media = len(media_sequence) if media_sequence else (len(keep_media_ids) + len(valid_new_files))
    if total_media == 0:
        return jsonify({'error': 'At least one media file is required'}), 400
    if total_media > 10:
        return jsonify({'error': 'Maximum 10 media files allowed'}), 400
    
    # Step 4: Apply ordering
    order_counter = 0
    processed_existing = set()
    
    if media_sequence:
        for entry in media_sequence:
            if isinstance(entry, dict) and entry.get('type') == 'existing':
                media_id = entry.get('id')
                media = Media.query.filter_by(id=media_id, post_id=post.id).first()
                if media:
                    media.order = order_counter
                    processed_existing.add(media_id)
                    order_counter += 1
            elif isinstance(entry, dict) and entry.get('type') == 'new':
                if new_file_index >= len(valid_new_files):
                    continue
                file = valid_new_files[new_file_index]
                new_file_index += 1
                if not allowed_file(file.filename):
                    return jsonify({'error': f'File type not allowed: {file.filename}'}), 400
                filename = secure_filename(file.filename)
                timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
                unique_filename = f"{current_user_id}_{post.id}_{timestamp}_{new_file_index}_{filename}"
                filepath = os.path.join(Config.UPLOAD_FOLDER, unique_filename)
                file.save(filepath)
                ext = filename.rsplit('.', 1)[1].lower()
                media_type = 'video' if ext == 'mp4' else 'image'
                media = Media(
                    post_id=post.id,
                    filename=unique_filename,
                    filepath=filepath,
                    media_type=media_type,
                    order=order_counter
                )
                db.session.add(media)
                order_counter += 1
    else:
        # Fallback: keep existing order then append new
        for media_id in keep_media_ids:
            media = Media.query.filter_by(id=media_id, post_id=post.id).first()
            if media:
                media.order = order_counter
                processed_existing.add(media_id)
                order_counter += 1
        for idx, file in enumerate(valid_new_files):
            if not allowed_file(file.filename):
                return jsonify({'error': f'File type not allowed: {file.filename}'}), 400
            filename = secure_filename(file.filename)
            timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
            unique_filename = f"{current_user_id}_{post.id}_{timestamp}_{idx}_{filename}"
            filepath = os.path.join(Config.UPLOAD_FOLDER, unique_filename)
            file.save(filepath)
            ext = filename.rsplit('.', 1)[1].lower()
            media_type = 'video' if ext == 'mp4' else 'image'
            media = Media(
                post_id=post.id,
                filename=unique_filename,
                filepath=filepath,
                media_type=media_type,
                order=order_counter + idx
            )
            db.session.add(media)
    
    db.session.commit()
    
    response = jsonify({
        'message': 'Post updated successfully',
        'post': post.to_dict(),
        'invalidate_cache': True
    })
    response.headers['X-Invalidate-Dashboard-Cache'] = 'true'
    return response, 200


@posts_bp.route('/<int:post_id>/simple', methods=['PUT'])
@jwt_required()
def update_post_simple(post_id):
    """
    Simple update for post metadata only (no media changes).
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
    Publish a post immediately.
    Uses the same publishing logic as scheduled posts.
    """
    from models import Team, TeamMember, Settings
    import os
    
    current_user_id = int(get_jwt_identity())
    post = Post.query.filter_by(id=post_id, user_id=current_user_id).first()
    
    if not post:
        return jsonify({'error': 'Post not found'}), 404
    
    if post.status == 'published':
        return jsonify({'error': 'Post already published'}), 400
    
    if not post.media or len(post.media) == 0:
        return jsonify({'error': 'Post has no media'}), 400
    
    # Get team credentials
    team = None
    if post.team_id:
        # Use the post's assigned team
        team = Team.query.get(post.team_id)
    else:
        # Fallback: get user's first team
        user_team = TeamMember.query.filter_by(user_id=current_user_id).first()
        if user_team:
            team = user_team.team
    
    if not team:
        return jsonify({'error': 'Team not found. Please assign this post to a team or join a team first.'}), 404
    
    if not team.instagram_access_token or not team.instagram_account_id:
        return jsonify({'error': 'Team Instagram account not connected. Please connect Instagram in team settings.'}), 400
    
    from instagram_api import InstagramAPI
    ig_api = InstagramAPI()
    
    try:
        # Update status immediately to prevent duplicate publishing attempts
        post.status = 'publishing'
        db.session.commit()
        
        # Get the public host URL from settings (same as scheduler), fallback to environment variable
        domain_setting = Settings.query.filter_by(key='app_domain').first()
        app_host = domain_setting.value if domain_setting else os.getenv('APP_HOST', 'http://127.0.0.1:5500')
        app_host = app_host.rstrip('/')  # avoid double slashes

        # Guard against localhost/127.0.0.1 which Instagram cannot fetch
        if 'localhost' in app_host or '127.0.0.1' in app_host:
            post.status = 'failed'
            post.error_message = 'APP_HOST/app_domain must be a publicly reachable HTTPS URL'
            db.session.commit()
            return jsonify({'error': 'APP_HOST/app_domain must be a publicly reachable HTTPS URL for Instagram to fetch media.'}), 400
        
        # Prepare publicly accessible media URLs (same as scheduler)
        media_urls = [
            f"{app_host}/api/posts/media/{media.id}"
            for media in post.media
        ]
        
        # Publish to Instagram using URLs (same as scheduler)
        instagram_post_id = ig_api.publish_post(
            team.instagram_access_token,
            team.instagram_account_id,
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
        
        return jsonify({'error': str(e)}), 400


@posts_bp.route('/media/<int:media_id>', methods=['GET'])
def serve_media(media_id):
    """
    Serve media file (for preview and Instagram API).
    """
    media = Media.query.get(media_id)
    
    if not media:
        return jsonify({'error': 'Media not found'}), 404
    
    # Determine MIME type using Python's mimetypes (more exhaustive)
    import mimetypes
    mime_type, _ = mimetypes.guess_type(media.filename)
    # Fallback for common cases
    if not mime_type:
        ext = media.filename.rsplit('.', 1)[1].lower() if '.' in media.filename else ''
        fallback_map = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'mp4': 'video/mp4',
            'mov': 'video/quicktime',
            'webm': 'video/webm',
        }
        mime_type = fallback_map.get(ext)
    # If still unknown, reject so Instagram doesn't get application/octet-stream
    if not mime_type:
        return jsonify({'error': 'Unsupported media type'}), 400
    
    response = send_from_directory(
        Config.UPLOAD_FOLDER,
        media.filename,
        as_attachment=False,
        mimetype=mime_type
    )
    # Encourage direct fetch by Instagram; disable auth/cookies implications
    response.headers['Cache-Control'] = 'public, max-age=3600'
    return response


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
