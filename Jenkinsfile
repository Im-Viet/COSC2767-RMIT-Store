pipeline {
  agent any

  options {
    timestamps()
    ansiColor('xterm')
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '10'))
  }

  parameters {
    string(name: 'AWS_REGION',    defaultValue: 'us-east-1', description: 'AWS region')
    string(name: 'EKS_CLUSTER',   defaultValue: 'rmit-eks',  description: 'EKS cluster name')
    string(name: 'K8S_NAMESPACE', defaultValue: 'dev',       description: 'Kubernetes namespace')
    string(name: 'BACKEND_REPO', defaultValue: 'rmit-store/backend', description: 'Backend repository')
    string(name: 'FRONTEND_REPO', defaultValue: 'rmit-store/frontend', description: 'Frontend repository')
    booleanParam(name: 'APPLY_MANIFESTS', defaultValue: false, description: 'Apply k8s/<namespace>/ manifests (first deploy)')
    booleanParam(name: 'SEED_DB',        defaultValue: false, description: 'Run seed job after deploy')
    booleanParam(name: 'RUN_NPM_INSTALL', defaultValue: true, description: 'Run npm ci for all packages before tests')
  }

  environment {
    REGION = "${params.AWS_REGION}"
    CLUSTER = "${params.EKS_CLUSTER}"
    NAMESPACE = "${params.K8S_NAMESPACE}"
    BACKEND_REPO = "${params.BACKEND_REPO}"
    FRONTEND_REPO = "${params.FRONTEND_REPO}"
    NPM_CONFIG_CACHE = "${JENKINS_HOME}/.npm-cache"
    DOCKER_BUILDKIT = "1"
  }

  stages {
    stage('Resolve IDs & Login to ECR') {
      steps {
        script {
          env.ACCOUNT_ID = sh(script: "aws sts get-caller-identity --query Account --output text", returnStdout: true).trim()
          env.ECR = "${env.ACCOUNT_ID}.dkr.ecr.${env.REGION}.amazonaws.com"
          env.GIT_SHA = sh(script: "git rev-parse --short=12 HEAD", returnStdout: true).trim()
          env.IMG_TAG = "${env.GIT_SHA}-${env.BUILD_NUMBER}"
          env.BACKEND_IMAGE = "${env.ECR}/rmit-store/backend:${env.IMG_TAG}"
          env.FRONTEND_IMAGE = "${env.ECR}/rmit-store/frontend:${env.IMG_TAG}"
        }
        sh 'aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR"'
      }
    }

    stage('Ensure ECR repositories') {
      steps {
        sh '''
          set -euo pipefail

          ensure_repo () {
            local repo="$1"
            if aws ecr describe-repositories --region "$REGION" --repository-names "$repo" >/dev/null 2>&1; then
              echo "ECR repo $repo already exists"
            else
              echo "Creating ECR repo: $repo"
              aws ecr create-repository \
                --region "$REGION" \
                --repository-name "$repo" \
                --image-scanning-configuration scanOnPush=true \
                --encryption-configuration encryptionType=AES256

              # Optional: keep only the last 10 images (best-effort; ignore if denied)
              aws ecr put-lifecycle-policy \
                --region "$REGION" \
                --repository-name "$repo" \
                --lifecycle-policy-text '{
                  "rules": [
                    {
                      "rulePriority": 1,
                      "description": "Keep last 10 images",
                      "selection": { "tagStatus": "any", "countType": "imageCountMoreThan", "countNumber": 10 },
                      "action": { "type": "expire" }
                    }
                  ]
                }' || true
            fi
          }

          ensure_repo "$BACKEND_REPO"
          ensure_repo "$FRONTEND_REPO"
        '''
      }
    }

    stage('Build backend image') {
      steps { sh 'docker build --no-cache -f server/Dockerfile -t "$BACKEND_IMAGE" .' }
    }

    stage('Build frontend image') {
      steps { sh 'docker build --no-cache -f client/Dockerfile -t "$FRONTEND_IMAGE" .' }
    }

    stage('Push images') {
      steps {
        sh '''
          docker push "$BACKEND_IMAGE"
          docker push "$FRONTEND_IMAGE"
        '''
      }
    }

    stage('Kube context') {
      steps { sh 'aws eks update-kubeconfig --region "$REGION" --name "$CLUSTER"' }
    }

    stage('Apply k8s manifests (first time only)') {
      when { expression { return params.APPLY_MANIFESTS } }
      steps { sh 'kubectl -n "$NAMESPACE" apply -f "k8s/$NAMESPACE"' }
    }

    stage('Deploy new images') {
      steps {
        sh '''
          # update Deployments to the freshly pushed images
          kubectl -n "$NAMESPACE" set image deploy/backend backend="$BACKEND_IMAGE"
          kubectl -n "$NAMESPACE" set image deploy/frontend frontend="$FRONTEND_IMAGE"

          # wait for rollouts
          kubectl -n "$NAMESPACE" rollout status deploy/backend --timeout=180s
          kubectl -n "$NAMESPACE" rollout status deploy/frontend --timeout=180s
        '''
      }
    }

    stage('Install (backend + e2e)') {
      when { expression { return params.RUN_NPM_INSTALL } }
      steps {
        sh '''
          set -euo pipefail

          # Prefer known locations; if they don’t exist, auto-discover.
          ROOTS=""
          [ -f server/package.json ]   && ROOTS="$ROOTS server"
          [ -f e2e/package.json ]      && ROOTS="$ROOTS e2e"
          [ -f frontend/package.json ] && ROOTS="$ROOTS frontend"
          [ -f client/package.json ]   && ROOTS="$ROOTS client"

          if [ -z "$ROOTS" ]; then
            # Fallback: find package.json one level down (excluding node_modules)
            ROOTS=$(find . -mindepth 1 -maxdepth 2 -type f -name package.json \
                     -not -path "*/node_modules/*" -printf "%h\n" | sort -u)
          fi

          if [ -z "$ROOTS" ]; then
            echo "No package.json found. Skipping installs."
            exit 0
          fi

          echo "Installing for: $ROOTS"
          for dir in $ROOTS; do
            echo "---- npm ci in $dir ----"
            npm ci --prefix "$dir" --no-audit --no-fund --prefer-offline
          done
        '''
      }
    }

    stage('Backend: Unit + Integration tests') {
      steps { sh 'npm run test' }
      post { always { junit allowEmptyResults: true, testResults: 'server/junit.xml' } }
    }

    stage('Compute E2E_BASE_URL') {
      steps {
        script {
          def ep = sh(script: "kubectl get svc ingress-nginx-controller -n ingress-nginx -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'", returnStdout: true).trim()
          if (!ep) {
            ep = sh(script: "kubectl get svc ingress-nginx-controller -n ingress-nginx -o jsonpath='{.status.loadBalancer.ingress[0].ip}'", returnStdout: true).trim()
          }
          env.E2E_BASE_URL = "http://${ep}:8080"
          echo "E2E_BASE_URL=${env.E2E_BASE_URL}"
        }
      }
    }

    stage('Seed database (from file)') {
      when { expression { return params.SEED_DB } }
      steps {
        withCredentials([usernamePassword(credentialsId: 'seed-admin',
                                          usernameVariable: 'SEED_ADMIN_EMAIL',
                                          passwordVariable: 'SEED_ADMIN_PASSWORD')]) {
          sh '''
            set -euo pipefail

            # Clean previous run (if any)
            kubectl -n "$NAMESPACE" delete job/seed-db --ignore-not-found=true

            # Create/refresh a temporary Secret with admin creds
            kubectl -n "$NAMESPACE" create secret generic seed-admin \
              --from-literal=email="$SEED_ADMIN_EMAIL" \
              --from-literal=password="$SEED_ADMIN_PASSWORD" \
              --dry-run=client -o yaml | kubectl apply -f -

            # Substitute image into the checked-in Job file and apply it
            sed "s|__IMAGE__|$BACKEND_IMAGE|g" k8s/99-seed-db.yaml \
              | kubectl -n "$NAMESPACE" apply -f -

            # Wait for the Job to finish (don’t fail the whole pipeline if it times out)
            kubectl -n "$NAMESPACE" wait --for=condition=complete job/seed-db --timeout=180s || true

            # Optional: keep or delete the secret; delete means creds won’t linger in the cluster
            kubectl -n "$NAMESPACE" delete secret seed-admin --ignore-not-found=true
          '''
        }
      }
    }

    stage('Web UI E2E (Playwright)') {
      environment { DEV_BASE_URL = "${env.DEV_BASE_URL}" }
      steps {
        withCredentials([usernamePassword(credentialsId: 'seed-admin',
                                          usernameVariable: 'E2E_EMAIL',
                                          passwordVariable: 'E2E_PASSWORD')]) {
          sh 'E2E_BASE_URL="${E2E_BASE_URL}" E2E_EMAIL="${E2E_EMAIL}" E2E_PASSWORD="${E2E_PASSWORD}" npm run test:e2e'
        }
      }
      post { always { archiveArtifacts artifacts: 'playwright-report/**', fingerprint: true } }
    }

    stage('Show endpoints') {
      steps {
        sh '''
          echo "=== Kubernetes objects ($NAMESPACE) ==="
          kubectl -n "$NAMESPACE" get deploy,svc,ingress -o wide || true

          echo "=== If using NGINX Ingress Service LB ==="
          kubectl -n ingress-nginx get svc ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].hostname}{"\\n"}' || true

          echo "You can test:   curl http://<ELB>/api/brand/list"
        '''
      }
    }

    stage('Promote to Prod') {
      when { expression { currentBuild.currentResult == 'SUCCESS' } }
      steps { echo 'All tests passed. Deploying to production...' }
    }
  }

  post {
    failure {
      echo "Deployment failed – attempting rollback"
      sh '''
        kubectl -n "$NAMESPACE" rollout undo deploy/backend || true
        kubectl -n "$NAMESPACE" rollout undo deploy/frontend || true
        kubectl -n "$NAMESPACE" get deploy -o wide || true
      '''
      emailext(
        subject: "❌ FAILED: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
        to: '$DEFAULT_RECIPIENTS',
        body: """
          <h2>Build Failed</h2>
          <p><b>Job:</b> ${env.JOB_NAME}<br/>
            <b>Build #:</b> ${env.BUILD_NUMBER}<br/>
            <b>Status:</b> ${currentBuild.currentResult}<br/>
            <b>Branch:</b> ${env.BRANCH_NAME ?: 'main'}</p>
          <p><a href="${env.BUILD_URL}">Open build</a></p>
        """
      )
    }
    always {
      archiveArtifacts artifacts: '**/Dockerfile, k8s/**/*.yaml', fingerprint: true, onlyIfSuccessful: false
    }
    success {
      echo "✅ Deployed images:"
      echo "   $BACKEND_IMAGE"
      echo "   $FRONTEND_IMAGE"
    }
  }
}
