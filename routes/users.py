from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User, Post, Team
from instagram_api import InstagramAPI
import logging

logger = logging.getLogger(__name__)
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
    Get user statistics including both PostWave and Instagram posts.
    """
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    # Get PostWave posts for this user
    total_postwave = Post.query.filter_by(user_id=current_user_id).count()
    scheduled_posts = Post.query.filter_by(user_id=current_user_id, status='scheduled').count()
    published_postwave = Post.query.filter_by(user_id=current_user_id, status='published').count()
    failed_posts = Post.query.filter_by(user_id=current_user_id, status='failed').count()
    draft_posts = Post.query.filter_by(user_id=current_user_id, status='draft').count()
    
    # Get Instagram posts if team is connected
    instagram_published = 0
    try:
        team_member = user.team_memberships[0] if user.team_memberships else None
        if team_member:
            team = team_member.team
            if team and team.instagram_account_id and team.instagram_access_token:
                ig_api = InstagramAPI()
                ig_posts, _ = ig_api.get_media_list_with_cache(
                    team.instagram_access_token,
                    team.instagram_account_id,
                    team.id,
                    limit=100,
                    use_cache=True
                )
                instagram_published = len(ig_posts) if ig_posts else 0
    except Exception as e:
        logger.debug(f'Failed to fetch Instagram posts for stats: {str(e)}')
    
    # Combine PostWave published with Instagram published
    total_published = published_postwave + instagram_published
    total_posts = total_postwave + instagram_published
    
    return jsonify({
        'total_posts': total_posts,
        'scheduled': scheduled_posts,
        'published': total_published,
        'failed': failed_posts,
        'drafts': draft_posts,
        'instagram_posts': instagram_published
    }), 200
