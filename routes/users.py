from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User

users_bp = Blueprint('users', __name__)


@users_bp.route('/profile', methods=['GET'])
@jwt_required()
def get_profile():
    """
    Get current user profile.
    """
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    return jsonify(user.to_dict()), 200


@users_bp.route('/stats', methods=['GET'])
@jwt_required()
def get_stats():
    """
    Get user statistics.
    """
    current_user_id = int(get_jwt_identity())
    
    from models import Post
    
    total_posts = Post.query.filter_by(user_id=current_user_id).count()
    scheduled_posts = Post.query.filter_by(user_id=current_user_id, status='scheduled').count()
    published_posts = Post.query.filter_by(user_id=current_user_id, status='published').count()
    failed_posts = Post.query.filter_by(user_id=current_user_id, status='failed').count()
    draft_posts = Post.query.filter_by(user_id=current_user_id, status='draft').count()
    
    return jsonify({
        'total_posts': total_posts,
        'scheduled': scheduled_posts,
        'published': published_posts,
        'failed': failed_posts,
        'drafts': draft_posts
    }), 200
