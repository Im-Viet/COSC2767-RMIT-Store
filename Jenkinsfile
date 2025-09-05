pipeline {
  agent any

  options {
    timestamps()
    ansiColor('xterm')
    buildDiscarder(logRotator(numToKeepStr: '10'))
  }

  environment {
    AWS_REGION         = 'us-east-1'               // <-- change if needed
    AWS_ACCOUNT_ID     = '029311331942'            // <-- your AWS academy acct
    ECR_BACKEND        = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/rmit-store/backend"
    ECR_FRONTEND       = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/rmit-store/frontend"
    GIT_SHA            = "${env.GIT_COMMIT?.take(7)}"
    DOCKER_BUILDKIT    = '1'
    // Jenkins file credentials (configure in Jenkins > Credentials)
    // - 'kubeconfig-dev'  : type=Secret file
    // - 'kubeconfig-prod' : type=Secret file
    // - 'notify-email'    : string or just configure Jenkins mailer globally
  }

  stages {
    stage('Docker Build & Push (ECR)') {
      steps {
        sh '''
          BACKEND_TAG="${ECR_BACKEND}:${GIT_SHA}"
          FRONTEND_TAG="${ECR_FRONTEND}:${GIT_SHA}"

          aws ecr create-repository --repository-name rmit-store/frontend --region ${AWS_REGION} || true

          aws ecr create-repository --repository-name rmit-store/backend --region ${AWS_REGION} || true

          aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

          docker build -t "$BACKEND_TAG" ./backend
          docker push "$BACKEND_TAG"
          
          docker build -t "$FRONTEND_TAG" ./client
          docker push "$FRONTEND_TAG"

          echo "$BACKEND_TAG" > backend.tag || true
          echo "$FRONTEND_TAG" > frontend.tag || true
        '''
        archiveArtifacts artifacts: '*.tag', fingerprint: true
      }
    }

    stage('Deploy to DEV (Ansible)') {
      steps {
        withCredentials([file(credentialsId: 'kubeconfig-dev', variable: 'KCFG')]) {
          sh '''
            export KUBECONFIG="$KCFG"
            BACKEND_IMG=$(cat backend.tag 2>/dev/null || true)
            FRONTEND_IMG=$(cat frontend.tag 2>/dev/null || true)

            ansible-playbook -i ansible/inventories/dev/hosts ansible/deploy-dev.yml \
              --extra-vars "backend_image=${BACKEND_IMG} frontend_image=${FRONTEND_IMG}"
          '''
        }
      }
    }

    stage('Promote to PROD (Blue/Green)') {
      when {
        anyOf {
          branch 'main'; branch 'master'
        }
      }
      steps {
        withCredentials([file(credentialsId: 'kubeconfig-prod', variable: 'KCFG')]) {
          sh '''
            export KUBECONFIG="$KCFG"
            BACKEND_IMG=$(cat backend.tag 2>/dev/null || true)
            FRONTEND_IMG=$(cat frontend.tag 2>/dev/null || true)

            ansible-playbook -i ansible/inventories/prod/hosts ansible/deploy-prod-bluegreen.yml \
              --extra-vars "backend_image=${BACKEND_IMG} frontend_image=${FRONTEND_IMG}"
          '''
        }
      }
    }
  }

  post {
    failure {
      // Requires Email Extension Plugin or global Mailer config
      emailext (
        subject: "[Jenkins] ❌ Build #${env.BUILD_NUMBER} failed: ${env.JOB_NAME}",
        body: """Build failed on ${env.NODE_NAME}
- Job: ${env.JOB_NAME}
- Build: ${env.BUILD_NUMBER}
- Commit: ${env.GIT_COMMIT}

See console: ${env.BUILD_URL}console
""",
        recipientProviders: [[$class: 'DevelopersRecipientProvider']]
      )
    }
    success {
      echo '✅ Pipeline succeeded.'
    }
  }
}
