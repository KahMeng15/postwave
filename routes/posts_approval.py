"""Post approval and team post management routes."""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User, Post, PostApproval, Team, TeamMember
from datetime import datetime
import logging

logger = logging.getLogger(__name__)
posts_bp = Blueprint('posts_approval', __name__)


@posts_bp.route('/team/<int:team_id>/posts', methods=['GET'])
@jwt_required()
def get_team_posts(team_id):
    """Get all posts for a team. Only team members or super admin."""
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    team = Team.query.get(team_id)
    if not team:
        return jsonify({'error': 'Team not found'}), 404
    
    # Check access
    is_member = any(tm.team_id == team_id for tm in user.team_memberships)
    if not is_member and not user.is_super_admin:
        return jsonify({'error': 'Access denied'}), 403
    
    # Get filter parameters
    status_filter = request.args.get('status')
    
    query = Post.query.filter_by(team_id=team_id)
    
    if status_filter:
        query = query.filter_by(status=status_filter)
    
    posts = query.order_by(Post.created_at.desc()).all()
    
    # Include approval info for each post
    posts_data = []
    for post in posts:
        post_dict = post.to_dict()
        
        # Get approval info if post is pending approval
        if post.status == 'pending_approval':
            approval = PostApproval.query.filter_by(post_id=post.id, team_id=team_id).first()
            if approval:
                post_dict['approval'] = approval.to_dict()
        
        posts_data.append(post_dict)
    
    return jsonify({'posts': posts_data}), 200


@posts_bp.route('/posts/<int:post_id>/send-approval', methods=['POST'])
@jwt_required()
def send_for_approval(post_id):
    """Send a post for team leader approval."""
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    post = Post.query.get(post_id)
    if not post:
        return jsonify({'error': 'Post not found'}), 404
    
    # Check that user owns the post
    if post.user_id != current_user_id:
        return jsonify({'error': 'You can only send your own posts for approval'}), 403
    
    # Post must be in draft status
    if post.status != 'draft':
        return jsonify({'error': 'Only draft posts can be sent for approval'}), 400
    
    team_id = post.team_id
    if not team_id:
        return jsonify({'error': 'Post is not associated with a team'}), 400
    
    try:
        # Check if user requires approval
        team_member = TeamMember.query.filter_by(
            team_id=team_id,
            user_id=current_user_id
        ).first()
        
        if not team_member or not team_member.requires_approval:
            return jsonify({'error': 'This post does not require approval'}), 400
        
        # Create approval record
        approval = PostApproval(
            post_id=post_id,
            team_id=team_id,
            status='pending'
        )
        
        # Update post status
        post.status = 'pending_approval'
        
        db.session.add(approval)
        db.session.commit()
        
        logger.info(f'Post {post_id} sent for approval by user {current_user_id}')
        
        return jsonify({
            'message': 'Post sent for approval',
            'post': post.to_dict()
        }), 200
    
    except Exception as e:
        db.session.rollback()
        logger.error(f'Failed to send post for approval: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to send post for approval'}), 500


@posts_bp.route('/posts/<int:post_id>/approve', methods=['POST'])
@jwt_required()
def approve_post(post_id):
    """Approve a post. Only team leader can approve."""
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    post = Post.query.get(post_id)
    if not post:
        return jsonify({'error': 'Post not found'}), 404
    
    if post.status != 'pending_approval':
        return jsonify({'error': 'Post is not pending approval'}), 400
    
    team_id = post.team_id
    team_member = TeamMember.query.filter_by(
        team_id=team_id,
        user_id=current_user_id
    ).first()
    
    # Check if user is team leader or super admin
    is_leader = team_member and team_member.role == 'leader'
    if not is_leader and not user.is_super_admin:
        return jsonify({'error': 'Only team leaders can approve posts'}), 403
    
    data = request.get_json() or {}
    comments = data.get('comments', '')
    
    try:
        # Update approval record
        approval = PostApproval.query.filter_by(post_id=post_id, team_id=team_id).first()
        if approval:
            approval.status = 'approved'
            approval.reviewed_by = current_user_id
            approval.review_comments = comments
            approval.reviewed_at = datetime.utcnow()
        
        # Update post status to scheduled (or user can still change the schedule)
        post.status = 'scheduled'
        
        db.session.commit()
        
        logger.info(f'Post {post_id} approved by user {current_user_id}')
        
        return jsonify({
            'message': 'Post approved successfully',
            'post': post.to_dict()
        }), 200
    
    except Exception as e:
        db.session.rollback()
        logger.error(f'Failed to approve post: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to approve post'}), 500


@posts_bp.route('/posts/<int:post_id>/reject', methods=['POST'])
@jwt_required()
def reject_post(post_id):
    """Reject a post. Only team leader can reject."""
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    post = Post.query.get(post_id)
    if not post:
        return jsonify({'error': 'Post not found'}), 404
    
    if post.status != 'pending_approval':
        return jsonify({'error': 'Post is not pending approval'}), 400
    
    team_id = post.team_id
    team_member = TeamMember.query.filter_by(
        team_id=team_id,
        user_id=current_user_id
    ).first()
    
    # Check if user is team leader or super admin
    is_leader = team_member and team_member.role == 'leader'
    if not is_leader and not user.is_super_admin:
        return jsonify({'error': 'Only team leaders can reject posts'}), 403
    
    data = request.get_json() or {}
    comments = data.get('comments', '')
    
    if not comments:
        return jsonify({'error': 'Rejection reason is required'}), 400
    
    try:
        # Update approval record
        approval = PostApproval.query.filter_by(post_id=post_id, team_id=team_id).first()
        if approval:
            approval.status = 'rejected'
            approval.reviewed_by = current_user_id
            approval.review_comments = comments
            approval.reviewed_at = datetime.utcnow()
        
        # Update post status to draft so user can edit
        post.status = 'draft'
        post.error_message = f'Rejected: {comments}'
        
        db.session.commit()
        
        logger.info(f'Post {post_id} rejected by user {current_user_id}')
        
        return jsonify({
            'message': 'Post rejected',
            'post': post.to_dict()
        }), 200
    
    except Exception as e:
        db.session.rollback()
        logger.error(f'Failed to reject post: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to reject post'}), 500


@posts_bp.route('/posts/<int:post_id>/pending-approvals', methods=['GET'])
@jwt_required()
def get_post_approvals(post_id):
    """Get approval history for a post."""
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    post = Post.query.get(post_id)
    if not post:
        return jsonify({'error': 'Post not found'}), 404
    
    # Check access
    if post.user_id != current_user_id and not user.is_super_admin:
        # Check if user is in the same team
        team_id = post.team_id
        if team_id:
            is_member = any(tm.team_id == team_id for tm in user.team_memberships)
            if not is_member:
                return jsonify({'error': 'Access denied'}), 403
    
    approvals = PostApproval.query.filter_by(post_id=post_id).all()
    
    return jsonify({
        'approvals': [a.to_dict() for a in approvals]
    }), 200
