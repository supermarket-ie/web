terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  # S3 remote state with locking. Values are supplied at init time via
  # -backend-config (see infra/terraform/backend.hcl.example), so nothing
  # account-specific is hardcoded. For local review only, run
  # `terraform init -backend=false`.
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "supermarket-ie"
      Environment = "preview"
      ManagedBy   = "terraform"
      Component   = "aws-migration-preview"
    }
  }
}
