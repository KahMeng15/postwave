"""
Database initialization and management script
"""
import os
import sys
from datetime import datetime
from app import create_app
from models import db, User, Post, Media

def init_db():
    """Initialize the database with tables."""
    app = create_app()
    with app.app_context():
        # Drop all tables (WARNING: This deletes all data)
        # db.drop_all()
        
        # Create all tables
        db.create_all()
        print("✅ Database tables created successfully!")

def create_test_user():
    """Create a test user for development."""
    app = create_app()
    with app.app_context():
        # Check if user exists
        existing = User.query.filter_by(username='admin').first()
        if existing:
            print("⚠️  Test user 'admin' already exists")
            return
        
        # Create user
        user = User(
            username='admin',
            email='admin@example.com'
        )
        user.set_password('admin123')
        
        db.session.add(user)
        db.session.commit()
        
        print("✅ Test user created:")
        print("   Username: admin")
        print("   Password: admin123")
        print("   Email: admin@example.com")

def reset_db():
    """Reset database (WARNING: Deletes all data)."""
    response = input("⚠️  This will delete ALL data. Are you sure? (yes/no): ")
    if response.lower() != 'yes':
        print("❌ Operation cancelled")
        return
    
    app = create_app()
    with app.app_context():
        db.drop_all()
        db.create_all()
        print("✅ Database reset successfully!")

def show_stats():
    """Show database statistics."""
    app = create_app()
    with app.app_context():
        users_count = User.query.count()
        posts_count = Post.query.count()
        media_count = Media.query.count()
        
        print("\n📊 Database Statistics:")
        print(f"   Users: {users_count}")
        print(f"   Posts: {posts_count}")
        print(f"   Media: {media_count}")
        print()
        
        # Status breakdown
        if posts_count > 0:
            draft = Post.query.filter_by(status='draft').count()
            scheduled = Post.query.filter_by(status='scheduled').count()
            published = Post.query.filter_by(status='published').count()
            failed = Post.query.filter_by(status='failed').count()
            
            print("📝 Post Status:")
            print(f"   Draft: {draft}")
            print(f"   Scheduled: {scheduled}")
            print(f"   Published: {published}")
            print(f"   Failed: {failed}")
            print()

def list_users():
    """List all users."""
    app = create_app()
    with app.app_context():
        users = User.query.all()
        
        print("\n👥 Users:")
        for user in users:
            ig_status = "✓ Connected" if user.instagram_account_id else "✗ Not connected"
            print(f"   ID: {user.id} | {user.username} | {user.email} | IG: {ig_status}")
        print()

def backup_db():
    """Create a backup of the database."""
    db_path = 'igscheduler.db'
    if not os.path.exists(db_path):
        print("❌ Database file not found")
        return
    
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_path = f'igscheduler_backup_{timestamp}.db'
    
    import shutil
    shutil.copy2(db_path, backup_path)
    print(f"✅ Database backed up to: {backup_path}")

def main():
    """Main menu."""
    if len(sys.argv) > 1:
        command = sys.argv[1]
        
        if command == 'init':
            init_db()
        elif command == 'test-user':
            create_test_user()
        elif command == 'reset':
            reset_db()
        elif command == 'stats':
            show_stats()
        elif command == 'users':
            list_users()
        elif command == 'backup':
            backup_db()
        else:
            print(f"❌ Unknown command: {command}")
            print_help()
    else:
        print_help()

def print_help():
    """Print help message."""
    print("\n🗄️  IG Scheduler Database Manager")
    print("=" * 50)
    print("\nUsage: python db_manager.py <command>")
    print("\nCommands:")
    print("  init       - Initialize database tables")
    print("  test-user  - Create test user (admin/admin123)")
    print("  reset      - Reset database (deletes all data)")
    print("  stats      - Show database statistics")
    print("  users      - List all users")
    print("  backup     - Create database backup")
    print("\nExamples:")
    print("  python db_manager.py init")
    print("  python db_manager.py test-user")
    print("  python db_manager.py stats")
    print()

if __name__ == '__main__':
    main()
